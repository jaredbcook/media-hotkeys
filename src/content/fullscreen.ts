import { FULLSCREEN_WRAPPER_ATTR } from "./constants.js";

let activeFullscreenWrapper: HTMLDivElement | null = null;
let activeFullscreenMedia: HTMLVideoElement | null = null;

function createFullscreenWrapperStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.dataset.mediaHotkeysFullscreen = "true";
  style.textContent = `
    [${FULLSCREEN_WRAPPER_ATTR}="true"]:fullscreen {
      align-items: center;
      background: #000;
      display: flex;
      height: 100%;
      justify-content: center;
      width: 100%;
    }

    [${FULLSCREEN_WRAPPER_ATTR}="true"]:fullscreen > video {
      height: 100%;
      object-fit: contain;
      width: 100%;
    }
  `;
  return style;
}

function ensureFullscreenWrapperStyles(): void {
  if (document.head.querySelector('style[data-media-hotkeys-fullscreen="true"]')) {
    return;
  }

  document.head.appendChild(createFullscreenWrapperStyle());
}

function getManagedFullscreenWrapper(media: HTMLVideoElement): HTMLDivElement | null {
  const parent = media.parentElement;
  if (!(parent instanceof HTMLDivElement)) {
    return null;
  }

  return parent.dataset.mediaHotkeysFullscreenWrapper === "true" ? parent : null;
}

function getExistingFullscreenHost(media: HTMLVideoElement): HTMLElement | null {
  const mediaRect = media.getBoundingClientRect();
  if (mediaRect.width <= 0 || mediaRect.height <= 0) {
    return null;
  }

  let candidate = media.parentElement;

  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    const mediaDescendants = candidate.querySelectorAll("video, audio");
    const candidateRect = candidate.getBoundingClientRect();
    const widthRatio = candidateRect.width / mediaRect.width;
    const heightRatio = candidateRect.height / mediaRect.height;
    const closelyWrapsMedia =
      candidateRect.width > 0 &&
      candidateRect.height > 0 &&
      widthRatio <= 1.5 &&
      heightRatio <= 1.5;

    if (mediaDescendants.length === 1 && mediaDescendants[0] === media && closelyWrapsMedia) {
      return candidate;
    }

    candidate = candidate.parentElement;
  }

  return null;
}

function wrapMediaForFullscreen(media: HTMLVideoElement): HTMLDivElement | null {
  const existingWrapper = getManagedFullscreenWrapper(media);
  if (existingWrapper) {
    return existingWrapper;
  }

  const parentNode = media.parentNode;
  if (!parentNode) {
    return null;
  }

  ensureFullscreenWrapperStyles();

  const wrapper = document.createElement("div");
  wrapper.dataset.mediaHotkeysFullscreenWrapper = "true";
  wrapper.style.lineHeight = "0";
  wrapper.style.position = "relative";

  const computedStyle = window.getComputedStyle(media);
  wrapper.style.display = computedStyle.display === "block" ? "block" : "inline-block";

  parentNode.insertBefore(wrapper, media);
  wrapper.appendChild(media);

  activeFullscreenWrapper = wrapper;
  activeFullscreenMedia = media;
  return wrapper;
}

export function getFullscreenHost(media: HTMLVideoElement): HTMLElement | null {
  return getExistingFullscreenHost(media) ?? wrapMediaForFullscreen(media);
}

export function unwrapManagedFullscreenMedia(): void {
  if (!activeFullscreenWrapper || !activeFullscreenMedia) {
    activeFullscreenWrapper = null;
    activeFullscreenMedia = null;
    return;
  }

  const wrapper = activeFullscreenWrapper;
  const media = activeFullscreenMedia;

  if (wrapper.isConnected) {
    const parentNode = wrapper.parentNode;
    if (parentNode) {
      parentNode.insertBefore(media, wrapper);
      wrapper.remove();
    }
  }

  activeFullscreenWrapper = null;
  activeFullscreenMedia = null;
}

export function handleFullscreenChange(): void {
  if (document.fullscreenElement === activeFullscreenWrapper) {
    return;
  }

  unwrapManagedFullscreenMedia();
}
