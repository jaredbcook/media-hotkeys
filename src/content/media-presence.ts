import type { MediaAction } from "../storage.js";
import {
  MEDIA_PRESENCE_REPORT_DELAY_MS,
  MEDIA_PRESENCE_REQUEST_TYPE,
  MEDIA_PRESENCE_TYPE,
  MESSAGE_SOURCE,
} from "./constants.js";
import {
  type FrameMediaPresenceMessage,
  type FrameMediaPresenceRequestMessage,
  findIframeForWindow,
  isIframeHidden,
  isTopWindow,
} from "./frame-messaging.js";
import { findIframes, findMedia, isTargetableMediaElement } from "./media-discovery.js";
import { getBestLocalCandidate } from "./media-scoring.js";
import { hasPlayablePlaceholder, isPlaceholderSized } from "./placeholder.js";
import { actionedMedia } from "./state.js";
import { isTheaterActive } from "./theater.js";

// Whether each child frame's subtree has controllable media, as last reported
// by that frame. Keyed by window so removed iframes drop out on their own.
const childFrameHasMedia = new WeakMap<Window, boolean>();
let lastReportedHasMedia: boolean | null = null;
let reportTimer: ReturnType<typeof setTimeout> | null = null;

function frameHasOwnMedia(): boolean {
  // Ambient loops don't count unless the extension already controls them, so
  // a muted ad or hero video doesn't make the parent take keys from the page.
  return findMedia(document).some(
    (media) => isTargetableMediaElement(media) || actionedMedia.has(media),
  );
}

function childFramesHaveMedia(): boolean {
  // A hidden iframe's media (a lightbox player preloaded at 0x0) doesn't take
  // keys from the page.
  return findIframes(document).some((iframe) => {
    const frameWindow = iframe.contentWindow;
    return (
      frameWindow !== null &&
      childFrameHasMedia.get(frameWindow) === true &&
      !isIframeHidden(iframe)
    );
  });
}

function reportToParent({ force = false } = {}): void {
  if (isTopWindow()) {
    return;
  }

  const hasMedia = frameHasOwnMedia() || childFramesHaveMedia();
  if (!force && hasMedia === lastReportedHasMedia) {
    return;
  }

  lastReportedHasMedia = hasMedia;
  const message: FrameMediaPresenceMessage = {
    source: MESSAGE_SOURCE,
    type: MEDIA_PRESENCE_TYPE,
    hasMedia,
  };
  try {
    window.parent.postMessage(message, "*");
  } catch {
    // The parent may be gone mid-navigation.
  }
}

/** Re-evaluates this frame's media presence soon and tells the parent if it changed. */
export function scheduleMediaPresenceReport(): void {
  if (isTopWindow() || reportTimer !== null) {
    return;
  }

  reportTimer = setTimeout(() => {
    reportTimer = null;
    reportToParent();
  }, MEDIA_PRESENCE_REPORT_DELAY_MS);
}

/**
 * Child frames report on load and on change. Reports sent before this frame's
 * content script was listening are lost, so this frame also asks its children
 * to report once it starts.
 */
export function initializeMediaPresence(): void {
  const request: FrameMediaPresenceRequestMessage = {
    source: MESSAGE_SOURCE,
    type: MEDIA_PRESENCE_REQUEST_TYPE,
  };
  for (const iframe of findIframes(document)) {
    try {
      iframe.contentWindow?.postMessage(request, "*");
    } catch {
      // Ignore inaccessible frame windows.
    }
  }

  reportToParent({ force: true });
}

export function handleMediaPresenceMessage(
  message: FrameMediaPresenceMessage | FrameMediaPresenceRequestMessage,
  source: Window,
): void {
  if (message.type === MEDIA_PRESENCE_REQUEST_TYPE) {
    if (source === window.parent) {
      reportToParent({ force: true });
    }
    return;
  }

  if (!findIframeForWindow(source)) {
    return;
  }

  childFrameHasMedia.set(source, message.hasMedia);
  // Children already coalesce their own changes, so pass this up without
  // another delay; nested frames would otherwise add one per level.
  reportToParent();
}

/**
 * Whether an action pressed in this frame could reach media. Answered
 * synchronously, because the keydown handler must decide whether to take the
 * key from the page (preventDefault) before cross-frame arbitration runs.
 * The play key also counts a click-to-play placeholder here, or an iframe
 * large enough to hold one, since placeholders aren't reported across frames.
 */
export function hasPotentialTarget(action: MediaAction): boolean {
  if (isTheaterActive() || getBestLocalCandidate() !== null || childFramesHaveMedia()) {
    return true;
  }

  if (action !== "togglePlayPause") {
    return false;
  }

  return (
    hasPlayablePlaceholder() || findIframes(document).some((iframe) => isPlaceholderSized(iframe))
  );
}
