import type { MediaAction, OverlayPosition, AdvancedSettings } from "./storage.js";
import * as icons from "./icons.js";

const OVERLAY_ID = "media-shortcuts-overlay";
const INSET_PX = 16;
const OVERLAY_ICON_SIZE_RATIO = 0.1;
const MIN_OVERLAY_ICON_SIZE_PX = 32;
const MAX_OVERLAY_ICON_SIZE_PX = 80;
const OVERLAY_TEXT_SIZE_RATIO = 0.025;
const MIN_OVERLAY_TEXT_SIZE_PX = 16;
const MAX_OVERLAY_TEXT_SIZE_PX = 24;

let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

type SkipAnimationDirection = "forward" | "backward";
type OverlayAnchorKind = "media" | "viewport";

interface OverlayAnchor {
  kind: OverlayAnchorKind;
  host: HTMLElement;
  position: "absolute" | "fixed";
  rect: DOMRect;
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

function getOrCreateOverlay(media?: HTMLMediaElement): HTMLElement {
  const parent = getFullscreenOverlayHost(media ?? null) ?? document.body;
  let el = document.getElementById(OVERLAY_ID);
  if (el) {
    if (el.parentElement !== parent) {
      parent.appendChild(el);
    }
    return el;
  }

  el = document.createElement("div");
  el.id = OVERLAY_ID;
  Object.assign(el.style, {
    position: "absolute",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "none",
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
  parent.appendChild(el);
  return el;
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

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.position = anchor.position;
  el.style.transform = `translate(${translateX}, ${translateY})`;
  el.style.setProperty("--media-shortcuts-translate-x", translateX);
  el.style.setProperty("--media-shortcuts-translate-y", translateY);
}

function buildContent(
  action: MediaAction,
  media: HTMLMediaElement,
  advancedSettings: AdvancedSettings,
  options: OverlayDisplayOptions,
): string | null {
  switch (action) {
    case "togglePlayPause":
      return media.paused ? icons.PAUSE : icons.PLAY;

    case "toggleMute":
      return `${media.muted ? icons.MUTE : icons.UNMUTE}<span>${media.muted ? 0 : Math.round(media.volume * 100)}%</span>`;

    case "toggleOverlays":
      return `<span>Overlays ${options.overlayEnabled ? "on" : "off"}</span>`;

    case "toggleFullscreen":
    case "togglePip":
      return null;

    case "volumeUp":
    case "volumeDown": {
      const icon =
        action === "volumeUp"
          ? icons.VOLUME_UP
          : media.volume <= 0
            ? icons.MUTE
            : icons.VOLUME_DOWN;
      const pct = Math.round(media.volume * 100);
      return `${icon}<span>${pct}%</span>`;
    }

    case "speedUp":
      return `${icons.SPEED_UP}<span>${media.playbackRate}x</span>`;

    case "slowDown":
      return `${icons.SPEED_DOWN}<span>${media.playbackRate}x</span>`;

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
  const el = getOrCreateOverlay(anchor.kind === "media" ? media : undefined);
  if (el.parentElement !== anchor.host) {
    anchor.host.appendChild(el);
  }

  if (hideTimeout) clearTimeout(hideTimeout);
  if (fadeTimeout) clearTimeout(fadeTimeout);

  el.innerHTML = content;
  resizeOverlayIcons(el, media);
  resizeOverlayText(el, media);
  el.style.display = "flex";
  el.style.opacity = "1";
  el.style.visibility = "hidden";
  el.style.transition = "";
  el.style.animation = "none";
  void el.offsetWidth;
  positionOverAnchor(el, anchor, position);
  el.style.visibility = "visible";

  if (options.animateSkipDirection) {
    const deltaX = options.animateSkipDirection === "forward" ? "-20%" : "20%";
    el.style.animation = `media-shortcuts-skip-slide 150ms ease-out`;
    el.style.setProperty("--media-shortcuts-slide-from-x", deltaX);
  }

  hideTimeout = setTimeout(() => {
    el.style.transition = `opacity ${advancedSettings.overlayFadeDuration}ms ease-out`;
    el.style.opacity = "0";
    fadeTimeout = setTimeout(() => {
      el.style.display = "none";
      el.style.visibility = "visible";
      el.style.animation = "none";
    }, advancedSettings.overlayFadeDuration);
  }, advancedSettings.overlayVisibleDuration);
}

const overlayStyles = document.createElement("style");
overlayStyles.textContent = `
  @keyframes media-shortcuts-skip-slide {
    from {
      transform: translate(
        calc(var(--media-shortcuts-translate-x, 0%) + var(--media-shortcuts-slide-from-x, 0px)),
        var(--media-shortcuts-translate-y, 0%)
      );
    }
    to {
      transform: translate(
        var(--media-shortcuts-translate-x, 0%),
        var(--media-shortcuts-translate-y, 0%)
      );
    }
  }
`;

if (!document.head.querySelector('style[data-media-shortcuts-overlay="true"]')) {
  overlayStyles.dataset.mediaShortcutsOverlay = "true";
  document.head.appendChild(overlayStyles);
}
