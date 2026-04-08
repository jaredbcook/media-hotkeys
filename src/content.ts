import {
  type MediaAction,
  type ExtensionSettings,
  DEFAULT_SETTINGS,
  buildKeyToActionMap,
  getSettings,
  resolveActionOverlaySettings,
} from "./storage.js";
import { showActionOverlay } from "./overlay.js";

export type { MediaAction };

// #region Types

type FrameActionRequestMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_HANDLE_ACTION";
  action: MediaAction;
  requestId: string;
};

type FrameActionResponseMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_ACTION_RESULT";
  requestId: string;
  handled: boolean;
};

type FrameMessage = FrameActionRequestMessage | FrameActionResponseMessage;

type SeekDirection = "forward" | "backward";

type SeekOverlayState = {
  direction: SeekDirection;
  media: HTMLMediaElement;
  totalSeconds: number;
  resetTimeout: ReturnType<typeof setTimeout> | null;
};

// #endregion

// #region Shared State and Constants

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let keyToActionMap: Map<string, MediaAction> = buildKeyToActionMap(settings.actions);
let lastInteractedMedia: HTMLMediaElement | null = null;
const MESSAGE_SOURCE = "media-shortcuts-extension";
const ACTION_REQUEST_TYPE = "MEDIA_SHORTCUTS_HANDLE_ACTION";
const ACTION_RESPONSE_TYPE = "MEDIA_SHORTCUTS_ACTION_RESULT";
const FRAME_ACTION_TIMEOUT_MS = 150;
const pendingFrameActionRequests = new Map<string, (handled: boolean) => void>();
const trackedMedia = new WeakSet<HTMLMediaElement>();
const observedRoots = new WeakSet<Document | ShadowRoot>();
let rootObserver: MutationObserver | null = null;
let shadowObserverPatched = false;
let seekOverlayState: SeekOverlayState | null = null;

// #endregion

// #region Settings Loading

async function loadSettings(): Promise<void> {
  try {
    settings = await getSettings();
    keyToActionMap = buildKeyToActionMap(settings.actions);
  } catch {
    // Keep defaults on failure
  }
}

export function setSettingsForTests(nextSettings: ExtensionSettings): void {
  settings = nextSettings;
  keyToActionMap = buildKeyToActionMap(settings.actions);
}

// #endregion

// #region Media and Frame Discovery

function hasNonEmptyAttribute(element: Element, name: string): boolean {
  const value = element.getAttribute(name);
  return typeof value === "string" && value.trim().length > 0;
}

function isValidMediaElement(media: HTMLMediaElement): boolean {
  if (typeof media.currentSrc === "string" && media.currentSrc.trim().length > 0) {
    return true;
  }

  if (hasNonEmptyAttribute(media, "src")) {
    return true;
  }

  if ("srcObject" in media && media.srcObject !== null) {
    return true;
  }

  return Array.from(media.querySelectorAll("source")).some((source) =>
    hasNonEmptyAttribute(source, "src"),
  );
}

function findMedia(root: Document | ShadowRoot | Element): HTMLMediaElement[] {
  const results: HTMLMediaElement[] = [];

  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (
      (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) &&
      isValidMediaElement(node)
    ) {
      results.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      results.push(...findMedia(node.shadowRoot));
    }
    node = walker.nextNode();
  }

  return results;
}

function findIframeWindows(root: Document | ShadowRoot | Element): Window[] {
  const results: Window[] = [];
  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof HTMLIFrameElement && node.contentWindow) {
      results.push(node.contentWindow);
    } else if (node instanceof Element && node.shadowRoot) {
      results.push(...findIframeWindows(node.shadowRoot));
    }
    node = walker.nextNode();
  }

  return results;
}

function debugLog(
  message: string,
  media?: HTMLMediaElement,
  details?: Record<string, unknown>,
): void {
  if (!settings.debugLogging) {
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

// #endregion

// #region Media Targeting and Tracking

/**
 * Determines which media element to control based on priority:
 * 1. Active element (if it's a supported media type)
 * 2. Currently playing media
 * 3. Most recently interacted media
 * 4. First supported media on page
 * @returns {HTMLMediaElement|null}
 */
export function getTargetMedia(): HTMLMediaElement | null {
  // 1. Active element
  const focused = document.activeElement;
  if (
    (focused instanceof HTMLVideoElement || focused instanceof HTMLAudioElement) &&
    isValidMediaElement(focused)
  ) {
    return focused as HTMLMediaElement;
  }

  const mediaList = findMedia(document);
  if (mediaList.length === 0) {
    return null;
  }

  // 2. Currently playing media
  // playing is !paused && !ended && readyState > 2
  const playingMedia = mediaList.find((m) => !m.paused && !m.ended && m.readyState > 2);
  if (playingMedia) {
    return playingMedia;
  }

  // 3. Most recently interacted media
  // Verify it's still in the document
  if (
    lastInteractedMedia &&
    lastInteractedMedia.isConnected &&
    isValidMediaElement(lastInteractedMedia)
  ) {
    return lastInteractedMedia;
  }

  // 4. First supported media element
  return mediaList[0] ?? null;
}

function trackInteraction(media: HTMLMediaElement, event: string): void {
  lastInteractedMedia = media;
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

function collectMediaAndShadowRoots(root: Document | ShadowRoot | Element): {
  media: HTMLMediaElement[];
  shadowRoots: ShadowRoot[];
} {
  const media: HTMLMediaElement[] = [];
  const shadowRoots: ShadowRoot[] = [];

  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (
      (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) &&
      isValidMediaElement(node)
    ) {
      media.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
      const nested = collectMediaAndShadowRoots(node.shadowRoot);
      media.push(...nested.media);
      shadowRoots.push(...nested.shadowRoots);
    }
    node = walker.nextNode();
  }

  return { media, shadowRoots };
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

function handleRootMutations(mutations: MutationRecord[]): void {
  let hasDomChanges = false;

  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
      hasDomChanges = true;
    }

    for (const node of mutation.addedNodes) {
      scanNode(node);
    }
  }

  if (hasDomChanges) {
    lastInteractedMedia = null;
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

function initializeDynamicMediaTracking(): void {
  patchAttachShadow();
  observeRoot(document);
}

// #endregion

// #region Media Actions

async function tryPlayMedia(media: HTMLMediaElement): Promise<void> {
  try {
    await media.play();
  } catch {
    // Ignore play() rejections. The extension invokes playback as a best-effort
    // action, and pages can legitimately block it due to autoplay policies.
  }
}

function playMedia(media: HTMLMediaElement): void {
  void tryPlayMedia(media);
}

function getEffectiveVolume(media: HTMLMediaElement): number {
  return media.muted ? 0 : media.volume;
}

function getSeekStep(action: MediaAction, globalSettings: ExtensionSettings): number | null {
  switch (action) {
    case "seekForwardSmall":
    case "seekBackwardSmall":
      return globalSettings.seekStepSmall;
    case "seekForwardMedium":
    case "seekBackwardMedium":
      return globalSettings.seekStepMedium;
    case "seekForwardLarge":
    case "seekBackwardLarge":
      return globalSettings.seekStepLarge;
    default:
      return null;
  }
}

function getSeekDirection(action: MediaAction): SeekDirection | null {
  if (action.startsWith("seekForward")) {
    return "forward";
  }

  if (action.startsWith("seekBackward")) {
    return "backward";
  }

  return null;
}

function clearSeekOverlayState(): void {
  if (seekOverlayState?.resetTimeout) {
    clearTimeout(seekOverlayState.resetTimeout);
  }
  seekOverlayState = null;
}

function getSeekOverlayDisplay(
  action: MediaAction,
  media: HTMLMediaElement,
): {
  seekSeconds?: number;
  animateSkipDirection?: SeekDirection;
} {
  const step = getSeekStep(action, settings);
  const direction = getSeekDirection(action);

  if (!step || !direction) {
    clearSeekOverlayState();
    return {};
  }

  const isContinuingStreak =
    seekOverlayState?.media === media && seekOverlayState.direction === direction;

  if (!isContinuingStreak) {
    clearSeekOverlayState();
  } else if (seekOverlayState?.resetTimeout) {
    clearTimeout(seekOverlayState.resetTimeout);
  }

  const projectedTime =
    direction === "forward" ? media.currentTime + step : media.currentTime - step;
  const wouldExceedBounds =
    projectedTime < 0 ||
    (Number.isFinite(media.duration) && media.duration > 0 && projectedTime > media.duration);
  const shouldResetStreak = !isContinuingStreak || wouldExceedBounds;
  const totalSeconds = settings.sumQuickSkips
    ? (shouldResetStreak ? 0 : (seekOverlayState?.totalSeconds ?? 0)) + step
    : step;
  const resetTimeout = setTimeout(() => {
    if (seekOverlayState?.media === media && seekOverlayState.direction === direction) {
      seekOverlayState = null;
    }
  }, settings.overlayVisibleDuration + settings.overlayFadeDuration);

  seekOverlayState = {
    direction,
    media,
    totalSeconds,
    resetTimeout,
  };

  return {
    seekSeconds: totalSeconds,
    animateSkipDirection: !settings.sumQuickSkips || !isContinuingStreak ? direction : undefined,
  };
}

function getOverlayDisplayOptions(
  action: MediaAction,
  media: HTMLMediaElement,
  previousTime?: number,
): {
  seekSeconds?: number;
  animateSkipDirection?: SeekDirection;
  timestampSeconds?: number;
  jumpDirection?: SeekDirection;
} {
  const percentMatch = action.match(/^seekToPercent(\d+)$/);
  if (percentMatch) {
    clearSeekOverlayState();
    return {
      timestampSeconds: media.currentTime,
      jumpDirection:
        typeof previousTime === "number" && media.currentTime < previousTime
          ? "backward"
          : "forward",
    };
  }

  return getSeekOverlayDisplay(action, media);
}

export function handleAction(action: MediaAction, media: HTMLMediaElement): void {
  const g = settings;
  const previousTime = media.currentTime;
  trackInteraction(media, `action:${action}`);

  switch (action) {
    case "togglePlayPause":
      media.paused ? playMedia(media) : media.pause();
      break;

    case "toggleMute":
      if (media.muted || media.volume === 0) {
        media.muted = false;
        media.volume = Math.max(g.volumeStep, media.volume);
      } else {
        media.muted = true;
      }
      break;

    case "toggleFullscreen":
      if (media instanceof HTMLVideoElement) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          media.requestFullscreen();
        }
      }
      break;

    case "togglePip":
      if (media instanceof HTMLVideoElement) {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
        } else {
          media.requestPictureInPicture();
        }
      }
      break;

    case "volumeUp":
      media.volume = Math.min(1, getEffectiveVolume(media) + g.volumeStep);
      media.muted = false;
      break;

    case "volumeDown":
      media.volume = Math.max(0, getEffectiveVolume(media) - g.volumeStep);
      media.muted = false;
      break;

    case "seekForwardSmall":
      media.currentTime += g.seekStepSmall;
      break;

    case "seekBackwardSmall":
      media.currentTime -= g.seekStepSmall;
      break;

    case "seekForwardMedium":
      media.currentTime += g.seekStepMedium;
      break;

    case "seekBackwardMedium":
      media.currentTime -= g.seekStepMedium;
      break;

    case "seekForwardLarge":
      media.currentTime += g.seekStepLarge;
      break;

    case "seekBackwardLarge":
      media.currentTime -= g.seekStepLarge;
      break;

    case "speedUp":
      media.playbackRate = Math.min(g.speedMax, media.playbackRate + g.speedStep);
      break;

    case "slowDown":
      media.playbackRate = Math.max(g.speedMin, media.playbackRate - g.speedStep);
      break;

    default: {
      const percentMatch = action.match(/^seekToPercent(\d+)$/);
      if (percentMatch && media.duration) {
        const percent = parseInt(percentMatch[1], 10) / 100;
        media.currentTime = media.duration * percent;
      }
    }
  }

  const actionConfig = settings.actions[action];
  const overlaySettings = resolveActionOverlaySettings(action, actionConfig, g);
  if (overlaySettings.overlayVisible) {
    showActionOverlay(
      action,
      media,
      overlaySettings.overlayPosition,
      g,
      getOverlayDisplayOptions(action, media, previousTime),
    );
  } else if (getSeekDirection(action)) {
    getSeekOverlayDisplay(action, media);
  } else {
    clearSeekOverlayState();
  }

  debugLog("Handled media action", media, { action });
}

// #endregion

// #region Frame Messaging

function isTopWindow(): boolean {
  return window.top === window;
}

function isFrameActionMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") {
    return false;
  }

  const message = data as Partial<FrameMessage>;
  return (
    message.source === MESSAGE_SOURCE &&
    typeof message.type === "string" &&
    typeof message.requestId === "string"
  );
}

function createFrameActionRequest(action: MediaAction): FrameActionRequestMessage {
  return {
    source: MESSAGE_SOURCE,
    type: ACTION_REQUEST_TYPE,
    action,
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function getChildFrameWindows(): Window[] {
  return findIframeWindows(document);
}

function postMessageToFrames(frameWindows: Window[], message: FrameActionRequestMessage): boolean {
  let posted = false;

  for (const frameWindow of frameWindows) {
    try {
      frameWindow.postMessage(message, "*");
      posted = true;
    } catch {
      // Ignore inaccessible frame windows and continue.
    }
  }

  return posted;
}

export function delegateActionToChildFrames(action: MediaAction): Promise<boolean> {
  const childFrames = getChildFrameWindows();
  if (childFrames.length === 0) {
    return Promise.resolve(false);
  }

  const request = createFrameActionRequest(action);
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingFrameActionRequests.delete(request.requestId);
      resolve(false);
    }, FRAME_ACTION_TIMEOUT_MS);

    pendingFrameActionRequests.set(request.requestId, (handled) => {
      window.clearTimeout(timeoutId);
      pendingFrameActionRequests.delete(request.requestId);
      resolve(handled);
    });

    const posted = postMessageToFrames(childFrames, request);
    if (!posted) {
      window.clearTimeout(timeoutId);
      pendingFrameActionRequests.delete(request.requestId);
      resolve(false);
    }
  });
}

async function handleIncomingFrameAction(action: MediaAction): Promise<boolean> {
  const localMedia = getTargetMedia();
  if (localMedia) {
    handleAction(action, localMedia);
    return true;
  }

  return delegateActionToChildFrames(action);
}

function respondToFrameAction(sourceWindow: Window, requestId: string, handled: boolean): void {
  const response: FrameActionResponseMessage = {
    source: MESSAGE_SOURCE,
    type: ACTION_RESPONSE_TYPE,
    requestId,
    handled,
  };

  sourceWindow.postMessage(response, "*");
}

function handleFrameMessage(event: MessageEvent): void {
  if (event.source !== window && !event.source) {
    return;
  }

  if (!isFrameActionMessage(event.data)) {
    return;
  }

  if (event.data.type === ACTION_RESPONSE_TYPE) {
    pendingFrameActionRequests.get(event.data.requestId)?.(event.data.handled);
    return;
  }

  if (!event.source || event.data.type !== ACTION_REQUEST_TYPE) {
    return;
  }

  void handleIncomingFrameAction(event.data.action).then((handled) => {
    respondToFrameAction(event.source as Window, event.data.requestId, handled);
  });
}

// #endregion

// #region Key Event Handling

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

function getKeyString(e: KeyboardEvent): string {
  if (e.shiftKey && e.key !== "Shift") {
    return e.key;
  }
  return e.key;
}

function hasReservedModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.altKey || e.ctrlKey;
}

async function handleKeyDown(e: KeyboardEvent): Promise<void> {
  if (isEditableTarget(document.activeElement)) return;
  if (hasReservedModifier(e)) return;

  const key = getKeyString(e);
  const action = keyToActionMap.get(key);
  if (!action) return;

  debugLog("Matched keydown to action", undefined, { action, key });

  e.preventDefault();
  e.stopPropagation();

  if (isTopWindow()) {
    const handledByChildFrame = await delegateActionToChildFrames(action);
    if (handledByChildFrame) {
      return;
    }
  }

  const media = getTargetMedia();
  if (!media) {
    debugLog("No media element found for action", undefined, { action, key });
    return;
  }

  handleAction(action, media);
}

// #endregion

// #region Initialization

window.addEventListener("message", handleFrameMessage);
document.addEventListener("keydown", handleKeyDown, true);
initializeDynamicMediaTracking();
void loadSettings();

// #endregion
