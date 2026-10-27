import { state } from "./state.js";

export function isElementVisible(element: Element, rect: DOMRect): boolean {
  if (rect.width <= 1 || rect.height <= 1) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.display === "none") {
    return false;
  }

  if (computedStyle.visibility === "hidden" || computedStyle.visibility === "collapse") {
    return false;
  }

  if (Number.parseFloat(computedStyle.opacity) === 0) {
    return false;
  }

  return true;
}

export function getVisibleViewportArea(rect: DOMRect): number {
  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

/** The focused element, following focus into open shadow roots. */
export function getDeepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

export function isWithinEditableElement(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    if (
      current instanceof HTMLInputElement ||
      current instanceof HTMLTextAreaElement ||
      current instanceof HTMLSelectElement
    ) {
      return true;
    }

    if (current instanceof HTMLElement) {
      const contentEditable = current.getAttribute("contenteditable");
      if (
        current.isContentEditable ||
        (contentEditable !== null && contentEditable.toLowerCase() !== "false")
      ) {
        return true;
      }
    }

    current = current.parentElement;
  }

  return false;
}

export function debugLog(
  message: string,
  media?: HTMLMediaElement,
  details?: Record<string, unknown>,
): void {
  if (!state.settings.advancedSettings.debugLogging) {
    return;
  }

  const mediaDetails = media
    ? {
        tagName: media.tagName,
        id: media.id || null,
        currentSrc: media.currentSrc || media.getAttribute("src") || null,
        currentTime: media.currentTime,
        paused: media.paused,
        muted: media.muted,
      }
    : {};

  console.info(`[Media Hotkeys][debug] ${message}`, {
    ...mediaDetails,
    ...details,
  });
}
