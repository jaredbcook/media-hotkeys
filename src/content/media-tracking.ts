import {
  FULLSCREEN_STYLE_ATTR,
  FULLSCREEN_WRAPPER_ATTR,
  OVERLAY_ID,
  OVERLAY_STYLE_ATTR,
} from "./constants.js";
import { debugLog } from "./dom-utils.js";
import { collectMediaAndShadowRoots } from "./media-discovery.js";
import { broadcastTopLevelSitePolicy } from "./frame-messaging.js";
import { state } from "./state.js";

const trackedMedia = new WeakSet<HTMLMediaElement>();
const observedRoots = new WeakSet<Document | ShadowRoot>();
let rootObserver: MutationObserver | null = null;
let shadowObserverPatched = false;

export function trackInteraction(media: HTMLMediaElement, event: string): void {
  state.lastInteractedMedia = media;
  debugLog("Tracked media interaction", media, { event });
}

function attachMediaTracking(media: HTMLMediaElement): void {
  if (trackedMedia.has(media)) {
    return;
  }

  trackedMedia.add(media);
  media.addEventListener("pointerdown", () => trackInteraction(media, "pointerdown"));
  media.addEventListener("play", () => trackInteraction(media, "play"));
  media.addEventListener("focus", () => trackInteraction(media, "focus"));
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
