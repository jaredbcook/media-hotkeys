import {
  FULLSCREEN_STYLE_ATTR,
  FULLSCREEN_WRAPPER_ATTR,
  OVERLAY_ID,
  OVERLAY_STYLE_ATTR,
} from "./constants.js";
import { debugLog, isElementVisible } from "./dom-utils.js";
import { collectMediaAndShadowRoots, findMedia, hasValidMediaSource } from "./media-discovery.js";
import { broadcastTopLevelSitePolicy } from "./frame-messaging.js";
import { state } from "./state.js";

const trackedMedia = new WeakSet<HTMLMediaElement>();
const observedRoots = new WeakSet<Document | ShadowRoot>();
let rootObserver: MutationObserver | null = null;
let shadowObserverPatched = false;
// Last known pointer position in viewport coordinates, or null when the
// pointer has left this frame's document.
let pointerPosition: { x: number; y: number } | null = null;

export function trackInteraction(media: HTMLMediaElement, event: string): void {
  state.lastInteractedMedia = media;
  debugLog("Tracked media interaction", media, { event });
}

function attachMediaTracking(media: HTMLMediaElement): void {
  if (trackedMedia.has(media)) {
    return;
  }

  trackedMedia.add(media);
  // Pointer interactions are tracked at the document level (see
  // handleDocumentPointerDown) so clicks on custom player chrome count too.
  media.addEventListener("play", () => trackInteraction(media, "play"));
  media.addEventListener("focus", () => trackInteraction(media, "focus"));
}

function rectContainsPoint(rect: DOMRect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

/**
 * The visible media whose box contains the point, preferring the smallest
 * (innermost) one when boxes overlap, e.g. a picture-in-picture inset.
 */
function findMediaAtPoint(point: { x: number; y: number }): HTMLMediaElement | null {
  let best: { media: HTMLMediaElement; area: number } | null = null;

  for (const media of findMedia(document)) {
    const rect = media.getBoundingClientRect();
    if (!rectContainsPoint(rect, point) || !isElementVisible(media, rect)) {
      continue;
    }

    const area = rect.width * rect.height;
    if (!best || area < best.area) {
      best = { media, area };
    }
  }

  return best?.media ?? null;
}

/** Whether the pointer currently rests over the given box. */
export function isPointerOverRect(rect: DOMRect): boolean {
  return pointerPosition !== null && rectContainsPoint(rect, pointerPosition);
}

export function handleDocumentPointerMove(event: PointerEvent): void {
  pointerPosition = { x: event.clientX, y: event.clientY };
}

export function handleDocumentMouseOut(event: MouseEvent): void {
  if (!event.relatedTarget) {
    pointerPosition = null;
  }
}

/**
 * Custom players (YouTube, Vimeo, Video.js, Plyr, MediaElement) lay their
 * controls over the <video>, so clicks on play/mute/seek land on overlay
 * elements and never reach the media element itself. Attribute any press
 * inside a media element's box to that media.
 */
export function handleDocumentPointerDown(event: PointerEvent): void {
  const directMedia = event
    .composedPath()
    .find((node): node is HTMLMediaElement => node instanceof HTMLMediaElement);
  if (directMedia && hasValidMediaSource(directMedia)) {
    trackInteraction(directMedia, "pointerdown");
    return;
  }

  if (typeof event.clientX !== "number" || typeof event.clientY !== "number") {
    return;
  }

  const point = { x: event.clientX, y: event.clientY };
  pointerPosition = point;

  const media = findMediaAtPoint(point);
  if (media) {
    trackInteraction(media, "pointerdown:player");
  }
}

/**
 * Scans a newly added DOM node for media elements and nested shadow roots.
 * Attaches media interaction tracking to discovered audio/video elements and
 * starts observing any shadow roots so later additions are detected as well.
 */
function scanNode(node: Node): void {
  if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
    attachMediaTracking(node);
    return;
  }

  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) {
    return;
  }

  if (node instanceof Element && node.shadowRoot) {
    observeRoot(node.shadowRoot);
  }

  if (node instanceof Element || node instanceof ShadowRoot) {
    const { media, shadowRoots } = collectMediaAndShadowRoots(node);
    for (const mediaElement of media) {
      attachMediaTracking(mediaElement);
    }
    for (const shadowRoot of shadowRoots) {
      observeRoot(shadowRoot);
    }
  }
}

function isExtensionManagedNode(node: Node): boolean {
  const directElement = node.nodeType === 1 ? (node as Element) : null;
  const parentElement =
    node.parentElement ?? (node.parentNode?.nodeType === 1 ? (node.parentNode as Element) : null);
  const element = directElement ?? parentElement;

  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(
      [
        `#${OVERLAY_ID}`,
        `style[${OVERLAY_STYLE_ATTR}="true"]`,
        `style[${FULLSCREEN_STYLE_ATTR}="true"]`,
        `[${FULLSCREEN_WRAPPER_ATTR}]`,
      ].join(", "),
    ),
  );
}

function handleRootMutations(mutations: MutationRecord[]): void {
  let hasDomChanges = false;

  for (const mutation of mutations) {
    const hasNonExtensionAddedNodes = Array.from(mutation.addedNodes).some(
      (node) => !isExtensionManagedNode(node),
    );
    const hasNonExtensionRemovedNodes = Array.from(mutation.removedNodes).some(
      (node) => !isExtensionManagedNode(node),
    );

    if (hasNonExtensionAddedNodes || hasNonExtensionRemovedNodes) {
      hasDomChanges = true;
    }

    for (const node of mutation.addedNodes) {
      scanNode(node);
    }
  }

  if (hasDomChanges) {
    // Only forget the interaction memory when the tracked element actually
    // left the document. Clearing on every unrelated mutation would erase the
    // recency scoring signal on dynamic pages moments after it is earned.
    if (state.lastInteractedMedia && !state.lastInteractedMedia.isConnected) {
      state.lastInteractedMedia = null;
    }

    broadcastTopLevelSitePolicy();
  }
}

function observeRoot(root: Document | ShadowRoot): void {
  if (observedRoots.has(root)) {
    return;
  }

  observedRoots.add(root);
  rootObserver ??= new MutationObserver(handleRootMutations);
  rootObserver.observe(root, {
    childList: true,
    subtree: true,
  });

  const { media, shadowRoots } = collectMediaAndShadowRoots(root);
  for (const mediaElement of media) {
    attachMediaTracking(mediaElement);
  }
  for (const shadowRoot of shadowRoots) {
    observeRoot(shadowRoot);
  }
}

function patchAttachShadow(): void {
  if (shadowObserverPatched || !("attachShadow" in Element.prototype)) {
    return;
  }

  shadowObserverPatched = true;
  const originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit): ShadowRoot {
    const shadowRoot = originalAttachShadow.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  };
}

export function initializeDynamicMediaTracking(): void {
  patchAttachShadow();
  observeRoot(document);
}
