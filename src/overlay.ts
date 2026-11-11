import type { MediaAction, OverlayPosition, AdvancedSettings } from "./storage.js";
import * as icons from "./icons.js";
import {
  readPlayerMuted,
  readPlayerPaused,
  readPlayerPlaybackRate,
  readPlayerVolume,
} from "./content/player-control.js";
import { OVERLAY_ATTR, OVERLAY_ID } from "./content/constants.js";
import { isTheaterMedia } from "./content/theater.js";

const INSET_PX = 16;
const OVERLAY_ICON_SIZE_RATIO = 0.1;
const MIN_OVERLAY_ICON_SIZE_PX = 32;
const MAX_OVERLAY_ICON_SIZE_PX = 80;
const OVERLAY_TEXT_SIZE_RATIO = 0.025;
const MIN_OVERLAY_TEXT_SIZE_PX = 16;
const MAX_OVERLAY_TEXT_SIZE_PX = 24;

let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * The overlay is a host element in the page's DOM, which carries only position
 * and visibility, around a box inside a closed shadow root, which carries
 * everything the user sees. The root is closed so page scripts can't reach
 * the box, and page CSS can't select what's inside it. The page can still
 * select the host, so its styles are set `!important` (see `setHostStyle`).
 */
interface Overlay {
  host: HTMLElement;
  box: HTMLElement;
}

let overlay: Overlay | null = null;

type SkipAnimationDirection = "forward" | "backward";
type OverlayAnchorKind = "media" | "viewport";

interface OverlayAnchor {
  kind: OverlayAnchorKind;
  host: HTMLElement;
  position: "absolute" | "fixed";
  rect: DOMRect;
  topLayer?: boolean;
}

function getFullscreenOverlayHost(media: HTMLMediaElement | null): HTMLElement | null {
  if (!media) {
    return null;
  }

  const fullscreenElement = document.fullscreenElement;
  if (!(fullscreenElement instanceof HTMLElement)) {
    return null;
  }

  return fullscreenElement.contains(media) ? fullscreenElement : null;
}

export interface OverlayDisplayOptions {
  seekSeconds?: number;
  animateSkipDirection?: SkipAnimationDirection;
  timestampSeconds?: number;
  jumpDirection?: SkipAnimationDirection;
  overlayEnabled?: boolean;
}

function formatTimestamp(seconds: number, includeHours: boolean): string {
  const clampedSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clampedSeconds / 3600);
  const minutes = Math.floor((clampedSeconds % 3600) / 60);
  const remainingSeconds = clampedSeconds % 60;

  if (includeHours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  const totalMinutes = Math.floor(clampedSeconds / 60);
  return `${totalMinutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

// Pages set rates too, so round for display: 1.1500000000000001 shows as 1.15.
function formatPlaybackRate(playbackRate: number): string {
  return String(Math.round(playbackRate * 100) / 100);
}

// Inline `!important` outranks page rules of either importance, so a broad
// selector such as `div { position: static !important }` can't move the host.
function setHostStyle(host: HTMLElement, property: string, value: string): void {
  host.style.setProperty(property, value, "important");
}

function createOverlay(): Overlay {
  // Orphans of an earlier content script (the extension was updated or
  // reloaded) can't be reached from this one, so they would only pile up. The
  // attribute marks them as ours; an element that merely shares the id is the
  // page's own and stays.
  document.querySelector(`#${OVERLAY_ID}[${OVERLAY_ATTR}]`)?.remove();

  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  host.setAttribute(OVERLAY_ATTR, "true");
  // `all: initial` first, so nothing the page sets on `div` is inherited into
  // the shadow tree or applies to the host. This also neutralizes the UA popover
  // box (border, margin, background, inset) when the host is promoted to the top
  // layer above a theater-mode video.
  setHostStyle(host, "all", "initial");
  setHostStyle(host, "position", "absolute");
  setHostStyle(host, "z-index", "2147483647");
  setHostStyle(host, "pointer-events", "none");
  setHostStyle(host, "display", "none");

  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = OVERLAY_STYLES;
  const box = document.createElement("div");
  Object.assign(box.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    borderRadius: "10px",
    padding: "8px 16px",
    fontFamily: "sans-serif",
    fontSize: "16px",
    fontWeight: "bold",
    lineHeight: "1.2",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  });
  root.append(style, box);
  return { host, box };
}

function getOrCreateOverlay(media?: HTMLMediaElement): Overlay {
  const parent = getFullscreenOverlayHost(media ?? null) ?? document.body;
  if (!overlay?.host.isConnected) {
    overlay = createOverlay();
  }
  if (overlay.host.parentElement !== parent) {
    parent.appendChild(overlay.host);
  }
  return overlay;
}

function isRectOutsideViewport(rect: DOMRect): boolean {
  return (
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= window.innerWidth ||
    rect.top >= window.innerHeight
  );
}

function isMediaVisiblyAnchorable(media: HTMLMediaElement, rect: DOMRect): boolean {
  if (media.hidden) {
    return false;
  }

  const computedStyle = window.getComputedStyle(media);
  if (computedStyle.display === "none") {
    return false;
  }

  if (computedStyle.visibility === "hidden" || computedStyle.visibility === "collapse") {
    return false;
  }

  if (Number.parseFloat(computedStyle.opacity) === 0) {
    return false;
  }

  if (rect.width <= 1 || rect.height <= 1) {
    return false;
  }

  return !isRectOutsideViewport(rect);
}

function getViewportAnchorRect(): DOMRect {
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

function resolveOverlayAnchor(media: HTMLMediaElement): OverlayAnchor {
  if (isTheaterMedia(media)) {
    return {
      kind: "media",
      host: document.body,
      position: "fixed",
      rect: media.getBoundingClientRect(),
      topLayer: true,
    };
  }

  const fullscreenHost = getFullscreenOverlayHost(media);
  if (fullscreenHost) {
    return {
      kind: "media",
      host: fullscreenHost,
      position: "fixed",
      rect: media.getBoundingClientRect(),
    };
  }

  const mediaRect = media.getBoundingClientRect();
  if (isMediaVisiblyAnchorable(media, mediaRect)) {
    return {
      kind: "media",
      host: document.body,
      position: "absolute",
      rect: mediaRect,
    };
  }

  return {
    kind: "viewport",
    host: document.body,
    position: "fixed",
    rect: getViewportAnchorRect(),
  };
}

/**
 * A theater-mode video lives in the top layer, above anything in the page, so
 * the overlay has to join it there. Re-showing on every update keeps the
 * overlay above a video that was promoted after the overlay was.
 */
function syncOverlayTopLayer(el: HTMLElement, topLayer: boolean): void {
  if (typeof el.showPopover !== "function") {
    return;
  }

  if (el.hasAttribute("popover")) {
    try {
      el.hidePopover();
    } catch {
      // Already hidden (e.g. it was just moved to a new parent).
    }
    el.removeAttribute("popover");
  }

  if (topLayer) {
    el.setAttribute("popover", "manual");
    el.showPopover();
  }
}

function clampCoordinate(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function positionOverAnchor(
  el: HTMLElement,
  anchor: OverlayAnchor,
  position: OverlayPosition,
): void {
  const rect = anchor.rect;
  const scrollX = anchor.position === "fixed" ? 0 : window.scrollX;
  const scrollY = anchor.position === "fixed" ? 0 : window.scrollY;
  const overlayWidth = el.offsetWidth;
  const overlayHeight = el.offsetHeight;

  const parts = position.split("-");
  let vertical: string;
  let horizontal: string;

  if (parts.length === 1) {
    // "center" or "top" or "bottom"
    if (parts[0] === "center") {
      vertical = "center";
      horizontal = "center";
    } else {
      vertical = parts[0];
      horizontal = "center";
    }
  } else {
    vertical = parts[0];
    horizontal = parts[1];
  }

  let left: number;
  let translateX: string;
  switch (horizontal) {
    case "left":
      left = rect.left + scrollX + INSET_PX;
      translateX = "0%";
      break;
    case "right":
      left = rect.right + scrollX - INSET_PX;
      translateX = "-100%";
      break;
    default: // center
      left = rect.left + scrollX + rect.width / 2;
      translateX = "-50%";
      break;
  }

  let top: number;
  let translateY: string;
  switch (vertical) {
    case "top":
      top = rect.top + scrollY + INSET_PX;
      translateY = "0%";
      break;
    case "bottom":
      top = rect.bottom + scrollY - INSET_PX;
      translateY = "-100%";
      break;
    default: // center
      top = rect.top + scrollY + rect.height / 2;
      translateY = "-50%";
      break;
  }

  if (anchor.kind === "viewport") {
    const minLeft =
      horizontal === "right"
        ? INSET_PX + overlayWidth
        : horizontal === "center"
          ? INSET_PX + overlayWidth / 2
          : INSET_PX;
    const maxLeft =
      horizontal === "right"
        ? window.innerWidth - INSET_PX
        : horizontal === "center"
          ? window.innerWidth - INSET_PX - overlayWidth / 2
          : window.innerWidth - INSET_PX - overlayWidth;
    const minTop =
      vertical === "bottom"
        ? INSET_PX + overlayHeight
        : vertical === "center"
          ? INSET_PX + overlayHeight / 2
          : INSET_PX;
    const maxTop =
      vertical === "bottom"
        ? window.innerHeight - INSET_PX
        : vertical === "center"
          ? window.innerHeight - INSET_PX - overlayHeight / 2
          : window.innerHeight - INSET_PX - overlayHeight;

    left = clampCoordinate(left, minLeft, maxLeft);
    top = clampCoordinate(top, minTop, maxTop);
  }

  setHostStyle(el, "left", `${left}px`);
  setHostStyle(el, "top", `${top}px`);
  setHostStyle(el, "position", anchor.position);
  setHostStyle(el, "transform", `translate(${translateX}, ${translateY})`);
}

function buildContent(
  action: MediaAction,
  media: HTMLMediaElement,
  advancedSettings: AdvancedSettings,
  options: OverlayDisplayOptions,
): string | null {
  switch (action) {
    case "togglePlayPause":
      return readPlayerPaused(media) ? icons.PAUSE : icons.PLAY;

    case "toggleMute": {
      const muted = readPlayerMuted(media);
      return `${muted ? icons.MUTE : icons.UNMUTE}<span>${muted ? 0 : Math.round(readPlayerVolume(media) * 100)}%</span>`;
    }

    case "toggleOverlays":
      return `<span>Overlays ${options.overlayEnabled ? "on" : "off"}</span>`;

    case "toggleFullscreen":
    case "togglePip":
    case "toggleTheater":
      return null;

    case "volumeUp":
    case "volumeDown": {
      const volume = readPlayerVolume(media);
      const icon =
        action === "volumeUp" ? icons.VOLUME_UP : volume <= 0 ? icons.MUTE : icons.VOLUME_DOWN;
      const pct = Math.round(volume * 100);
      return `${icon}<span>${pct}%</span>`;
    }

    case "speedUp":
      return `${icons.SPEED_UP}<span>${formatPlaybackRate(readPlayerPlaybackRate(media))}x</span>`;

    case "slowDown":
      return `${icons.SPEED_DOWN}<span>${formatPlaybackRate(readPlayerPlaybackRate(media))}x</span>`;

    case "seekForwardLarge":
      return `${icons.SEEK_FWD_LARGE}<span>+${options.seekSeconds ?? advancedSettings.seekStepLarge}s</span>`;

    case "seekBackwardLarge":
      return `${icons.SEEK_BACK_LARGE}<span>-${options.seekSeconds ?? advancedSettings.seekStepLarge}s</span>`;

    case "seekForwardSmall":
      return `${icons.SEEK_FWD_SMALL}<span>+${options.seekSeconds ?? advancedSettings.seekStepSmall}s</span>`;

    case "seekBackwardSmall":
      return `${icons.SEEK_BACK_SMALL}<span>-${options.seekSeconds ?? advancedSettings.seekStepSmall}s</span>`;

    case "seekForwardMedium":
      return `${icons.SEEK_FWD_LARGE}<span>+${options.seekSeconds ?? advancedSettings.seekStepMedium}s</span>`;

    case "seekBackwardMedium":
      return `${icons.SEEK_BACK_LARGE}<span>-${options.seekSeconds ?? advancedSettings.seekStepMedium}s</span>`;

    case "restart":
      return `${icons.TIME_BACKWARD}<span>${formatTimestamp(0, Number.isFinite(media.duration) && media.duration >= 3600)}</span>`;

    default: {
      const percentMatch = action.match(/^seekToPercent\d+$/);
      if (percentMatch && typeof options.timestampSeconds === "number") {
        const icon =
          options.jumpDirection === "backward" ? icons.TIME_BACKWARD : icons.TIME_FORWARD;
        return `${icon}<span>${formatTimestamp(
          options.timestampSeconds,
          Number.isFinite(media.duration) && media.duration >= 3600,
        )}</span>`;
      }
      return null;
    }
  }
}

function getOverlayIconSizePx(media: HTMLMediaElement): number {
  const desiredSize = media.getBoundingClientRect().width * OVERLAY_ICON_SIZE_RATIO;
  return Math.min(MAX_OVERLAY_ICON_SIZE_PX, Math.max(MIN_OVERLAY_ICON_SIZE_PX, desiredSize));
}

function getOverlayTextSizePx(media: HTMLMediaElement): number {
  const desiredSize = media.getBoundingClientRect().width * OVERLAY_TEXT_SIZE_RATIO;
  return Math.min(MAX_OVERLAY_TEXT_SIZE_PX, Math.max(MIN_OVERLAY_TEXT_SIZE_PX, desiredSize));
}

function resizeOverlayIcons(el: HTMLElement, media: HTMLMediaElement): void {
  const iconSizePx = getOverlayIconSizePx(media);

  for (const icon of el.querySelectorAll("svg")) {
    icon.style.width = `${iconSizePx}px`;
    icon.style.height = `${iconSizePx}px`;
  }
}

function resizeOverlayText(el: HTMLElement, media: HTMLMediaElement): void {
  el.style.fontSize = `${getOverlayTextSizePx(media)}px`;
}

// The box slides on its own so the host's transform, which positions the
// overlay, stays untouched. A percentage translates by the box's own width.
const OVERLAY_STYLES = `
  @keyframes media-hotkeys-skip-slide {
    from {
      transform: translateX(var(--media-hotkeys-slide-from-x, 0%));
    }
    to {
      transform: translateX(0);
    }
  }
`;

export function showActionOverlay(
  action: MediaAction,
  media: HTMLMediaElement,
  position: OverlayPosition,
  advancedSettings: AdvancedSettings,
  options: OverlayDisplayOptions = {},
): void {
  const content = buildContent(action, media, advancedSettings, options);
  if (!content) return;

  const anchor = resolveOverlayAnchor(media);
  const { host, box } = getOrCreateOverlay(anchor.kind === "media" ? media : undefined);
  if (host.parentElement !== anchor.host) {
    anchor.host.appendChild(host);
  }
  syncOverlayTopLayer(host, anchor.topLayer === true);

  if (hideTimeout) clearTimeout(hideTimeout);
  if (fadeTimeout) clearTimeout(fadeTimeout);

  box.innerHTML = content;
  resizeOverlayIcons(box, media);
  resizeOverlayText(box, media);
  setHostStyle(host, "display", "block");
  setHostStyle(host, "opacity", "1");
  setHostStyle(host, "visibility", "hidden");
  setHostStyle(host, "transition", "none");
  box.style.animation = "none";
  void host.offsetWidth;
  positionOverAnchor(host, anchor, position);
  setHostStyle(host, "visibility", "visible");

  if (options.animateSkipDirection) {
    const deltaX = options.animateSkipDirection === "forward" ? "-20%" : "20%";
    box.style.animation = `media-hotkeys-skip-slide 150ms ease-out`;
    box.style.setProperty("--media-hotkeys-slide-from-x", deltaX);
  }

  hideTimeout = setTimeout(() => {
    setHostStyle(host, "transition", `opacity ${advancedSettings.overlayFadeDuration}ms ease-out`);
    setHostStyle(host, "opacity", "0");
    fadeTimeout = setTimeout(() => {
      setHostStyle(host, "display", "none");
      setHostStyle(host, "visibility", "visible");
      box.style.animation = "none";
    }, advancedSettings.overlayFadeDuration);
  }, advancedSettings.overlayVisibleDuration);
}
