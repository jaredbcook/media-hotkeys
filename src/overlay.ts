import type { MediaAction, OverlayPosition, GlobalSettings } from "./storage.js";
import * as icons from "./icons.js";

const OVERLAY_ID = "media-shortcuts-overlay";
const INSET_PX = 12;

let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

function getOrCreateOverlay(): HTMLElement {
  let el = document.getElementById(OVERLAY_ID);
  if (el) return el;

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
    gap: "4px",
    background: "rgba(0, 0, 0, 0.7)",
    color: "#fff",
    borderRadius: "10px",
    padding: "15px 20px",
    fontFamily: "sans-serif",
    fontSize: "16px",
    fontWeight: "bold",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  });
  document.body.appendChild(el);
  return el;
}

function positionOverMedia(
  el: HTMLElement,
  media: HTMLMediaElement,
  position: OverlayPosition,
): void {
  const rect = media.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

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

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transform = `translate(${translateX}, ${translateY})`;
}

function buildContent(
  action: MediaAction,
  media: HTMLMediaElement,
  globalSettings: GlobalSettings,
): string | null {
  switch (action) {
    case "togglePlayPause":
      return media.paused ? icons.PAUSE : icons.PLAY;

    case "toggleMute":
      return media.muted ? icons.MUTE : icons.UNMUTE;

    case "toggleFullscreen":
    case "togglePip":
      return null;

    case "volumeUp":
    case "volumeDown": {
      const icon = action === "volumeUp" ? icons.VOLUME_UP : icons.VOLUME_DOWN;
      const pct = Math.round(media.volume * 100);
      return `${icon}<span>${pct}%</span>`;
    }

    case "speedUp":
      return `${icons.SPEED_UP}<span>${media.playbackRate}x</span>`;

    case "slowDown":
      return `${icons.SPEED_DOWN}<span>${media.playbackRate}x</span>`;

    case "seekForwardLarge":
      return `${icons.SEEK_FWD_LARGE}<span>+${globalSettings.seekStepLarge}s</span>`;

    case "seekBackwardLarge":
      return `${icons.SEEK_BACK_LARGE}<span>-${globalSettings.seekStepLarge}s</span>`;

    case "seekForwardSmall":
      return `${icons.SEEK_FWD_SMALL}<span>+${globalSettings.seekStepSmall}s</span>`;

    case "seekBackwardSmall":
      return `${icons.SEEK_BACK_SMALL}<span>-${globalSettings.seekStepSmall}s</span>`;

    case "seekForwardMedium":
      return `${icons.SEEK_FWD_LARGE}<span>+${globalSettings.seekStepMedium}s</span>`;

    case "seekBackwardMedium":
      return `${icons.SEEK_BACK_LARGE}<span>-${globalSettings.seekStepMedium}s</span>`;

    default:
      return null;
  }
}

export function showActionOverlay(
  action: MediaAction,
  media: HTMLMediaElement,
  position: OverlayPosition,
  globalSettings: GlobalSettings,
): void {
  const content = buildContent(action, media, globalSettings);
  if (!content) return;

  const el = getOrCreateOverlay();

  if (hideTimeout) clearTimeout(hideTimeout);
  if (fadeTimeout) clearTimeout(fadeTimeout);

  el.innerHTML = content;
  positionOverMedia(el, media, position);
  el.style.display = "flex";
  el.style.opacity = "1";
  el.style.transition = "";

  hideTimeout = setTimeout(() => {
    el.style.transition = `opacity ${globalSettings.overlayFadeDuration}ms ease-out`;
    el.style.opacity = "0";
    fadeTimeout = setTimeout(() => {
      el.style.display = "none";
    }, globalSettings.overlayFadeDuration);
  }, globalSettings.overlayVisibleDuration);
}
