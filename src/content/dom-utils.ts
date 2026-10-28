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

/** A box in viewport coordinates. A clipped-away box can have right < left. */
export type Box = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

function intersectBoxes(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

export function isEmptyBox(box: Box): boolean {
  return box.right - box.left <= 1 || box.bottom - box.top <= 1;
}

/** The ancestor's box on the axes where `clips` says its overflow is cut off. */
function getOverflowClip(
  rect: DOMRect,
  style: CSSStyleDeclaration,
  clips: (overflow: string) => boolean,
): Box {
  const clipsX = clips(style.overflowX);
  const clipsY = clips(style.overflowY);
  return {
    left: clipsX ? rect.left : -Infinity,
    top: clipsY ? rect.top : -Infinity,
    right: clipsX ? rect.right : Infinity,
    bottom: clipsY ? rect.bottom : Infinity,
  };
}

function clipsOverflow(overflow: string): boolean {
  return overflow !== "" && overflow !== "visible";
}

function hidesOverflow(overflow: string): boolean {
  return overflow === "hidden" || overflow === "clip";
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "none";
}

// Whether the element is the containing block of fixed-position descendants.
function containsFixedDescendants(style: CSSStyleDeclaration): boolean {
  return (
    isSet(style.transform) ||
    isSet(style.perspective) ||
    isSet(style.filter) ||
    isSet(style.backdropFilter) ||
    /paint|layout|strict|content/.test(style.contain) ||
    /transform|perspective|filter/.test(style.willChange) ||
    (isSet(style.containerType) && style.containerType !== "normal")
  );
}

// Overflow clipping only applies to descendants whose containing block chain
// passes through the clipping element, so a fixed or absolutely positioned
// descendant can escape an `overflow: hidden` ancestor.
function containsDescendant(style: CSSStyleDeclaration, descendantPosition: string): boolean {
  if (descendantPosition === "fixed") {
    return containsFixedDescendants(style);
  }

  if (descendantPosition === "absolute") {
    return isPositioned(style) || containsFixedDescendants(style);
  }

  return true;
}

function isPositioned(style: CSSStyleDeclaration): boolean {
  return style.position !== "" && style.position !== "static";
}

function getFlatTreeParent(element: Element): Element | null {
  if (element.assignedSlot) {
    return element.assignedSlot;
  }

  if (element.parentElement) {
    return element.parentElement;
  }

  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * The part of the element's box its ancestors don't clip away, or null when
 * the page hides it: `display: none` or `visibility: hidden`, zero opacity on
 * it or any ancestor, or cut off entirely by an `overflow: hidden` or `clip`
 * ancestor, as in a collapsed menu or panel. A scroll container clips the box
 * without hiding it, because the user can scroll it into view, just like
 * content outside the viewport. The viewport itself doesn't clip here; see
 * getVisibleViewportArea.
 */
export function getVisibleBox(element: Element): Box | null {
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    Number.parseFloat(style.opacity) === 0
  ) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  // A box without layout (or without a size yet) can't be judged by clipping.
  const canClip = !isEmptyBox(rect);
  let visibleBox: Box = rect;
  let unhiddenBox: Box = rect;
  let position = style.position;

  for (
    let ancestor = getFlatTreeParent(element);
    ancestor;
    ancestor = getFlatTreeParent(ancestor)
  ) {
    const ancestorStyle = window.getComputedStyle(ancestor);
    if (ancestorStyle.display === "none" || Number.parseFloat(ancestorStyle.opacity) === 0) {
      return null;
    }

    if (!containsDescendant(ancestorStyle, position)) {
      continue;
    }

    // The root and body overflow scroll the viewport rather than clip a box.
    const isViewportScroller = ancestor === document.documentElement || ancestor === document.body;
    if (
      canClip &&
      !isViewportScroller &&
      (clipsOverflow(ancestorStyle.overflowX) || clipsOverflow(ancestorStyle.overflowY))
    ) {
      const ancestorRect = ancestor.getBoundingClientRect();
      visibleBox = intersectBoxes(
        visibleBox,
        getOverflowClip(ancestorRect, ancestorStyle, clipsOverflow),
      );
      unhiddenBox = intersectBoxes(
        unhiddenBox,
        getOverflowClip(ancestorRect, ancestorStyle, hidesOverflow),
      );
      if (isEmptyBox(unhiddenBox)) {
        return null;
      }
    }

    position = ancestorStyle.position;
  }

  return visibleBox;
}

export function getVisibleViewportArea(rect: Box): number {
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
