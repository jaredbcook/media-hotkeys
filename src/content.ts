import {
  type AdvancedSettings,
  type ConfigurableMediaAction,
  type MediaAction,
  type ExtensionSettings,
  DEFAULT_SETTINGS,
  buildKeyToActionMap,
  getSettings,
  normalizeHotkeyKey,
  resolveActionOverlaySettings,
  saveSettings,
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

const NUMBER_KEY_ACTIONS: Record<string, MediaAction> = {
  "0": "seekToPercent0",
  "1": "seekToPercent10",
  "2": "seekToPercent20",
  "3": "seekToPercent30",
  "4": "seekToPercent40",
  "5": "seekToPercent50",
  "6": "seekToPercent60",
  "7": "seekToPercent70",
  "8": "seekToPercent80",
  "9": "seekToPercent90",
};

// #endregion

// #region Shared State and Constants

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let keyToActionMap: Map<string, MediaAction> = buildKeyToActionMap(
  settings.quickSettings.actionKeyBindings,
);
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
let activeFullscreenWrapper: HTMLDivElement | null = null;
let activeFullscreenMedia: HTMLVideoElement | null = null;

const FULLSCREEN_WRAPPER_ATTR = "data-media-hotkeys-fullscreen-wrapper";

// #endregion

// #region Settings Loading

async function loadSettings(): Promise<void> {
  try {
    settings = await getSettings();
    keyToActionMap = buildKeyToActionMap(settings.quickSettings.actionKeyBindings);
  } catch {
    // Keep defaults on failure
  }
}

export function setSettingsForTests(nextSettings: ExtensionSettings): void {
  settings = nextSettings;
  keyToActionMap = buildKeyToActionMap(settings.quickSettings.actionKeyBindings);
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
  if (!settings.advancedSettings.debugLogging) {
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

// #region Fullscreen Overlay Support

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

function getFullscreenHost(media: HTMLVideoElement): HTMLElement | null {
  return getExistingFullscreenHost(media) ?? wrapMediaForFullscreen(media);
}

function unwrapManagedFullscreenMedia(): void {
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

function handleFullscreenChange(): void {
  if (document.fullscreenElement === activeFullscreenWrapper) {
    return;
  }

  unwrapManagedFullscreenMedia();
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

function getSeekStep(action: MediaAction, advancedSettings: AdvancedSettings): number | null {
  switch (action) {
    case "seekForwardSmall":
    case "seekBackwardSmall":
      return advancedSettings.seekStepSmall;
    case "seekForwardMedium":
    case "seekBackwardMedium":
      return advancedSettings.seekStepMedium;
    case "seekForwardLarge":
    case "seekBackwardLarge":
      return advancedSettings.seekStepLarge;
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

function isGlobalAction(action: MediaAction): action is "toggleOverlays" {
  return action === "toggleOverlays";
}

function isConfigurableMediaAction(action: MediaAction): action is ConfigurableMediaAction {
  return action in settings.quickSettings.actionKeyBindings;
}

function toggleOverlayVisibility(): void {
  settings.advancedSettings.showOverlays = !settings.advancedSettings.showOverlays;
  void saveSettings({
    advancedSettings: {
      showOverlays: settings.advancedSettings.showOverlays,
    },
  });
}

async function handleGlobalAction(action: "toggleOverlays"): Promise<boolean> {
  const media = getTargetMedia();
  if (media) {
    handleAction(action, media);
  } else {
    toggleOverlayVisibility();
  }

  const handledByChildFrame = await delegateActionToChildFrames(action);
  return Boolean(media) || handledByChildFrame;
}

function getSeekOverlayDisplay(
  action: MediaAction,
  media: HTMLMediaElement,
): {
  seekSeconds?: number;
  animateSkipDirection?: SeekDirection;
} {
  const step = getSeekStep(action, settings.advancedSettings);
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
  const totalSeconds = settings.advancedSettings.sumQuickSkips
    ? (shouldResetStreak ? 0 : (seekOverlayState?.totalSeconds ?? 0)) + step
    : step;
  const resetTimeout = setTimeout(() => {
    if (seekOverlayState?.media === media && seekOverlayState.direction === direction) {
      seekOverlayState = null;
    }
  }, settings.advancedSettings.overlayVisibleDuration + settings.advancedSettings.overlayFadeDuration);

  seekOverlayState = {
    direction,
    media,
    totalSeconds,
    resetTimeout,
  };

  const animateSkipDirection =
    settings.advancedSettings.skipOverlayPosition === "left / right" &&
    (!settings.advancedSettings.sumQuickSkips || !isContinuingStreak)
      ? direction
      : undefined;

  return {
    seekSeconds: totalSeconds,
    animateSkipDirection,
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
  overlayEnabled?: boolean;
} {
  if (action === "toggleOverlays") {
    clearSeekOverlayState();
    return {
      overlayEnabled: settings.advancedSettings.showOverlays,
    };
  }

  if (action === "restart") {
    clearSeekOverlayState();
    return {
      timestampSeconds: 0,
      jumpDirection: "backward",
    };
  }

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
  const advancedSettings = settings.advancedSettings;
  const previousTime = media.currentTime;
  trackInteraction(media, `action:${action}`);

  switch (action) {
    case "togglePlayPause":
      media.paused ? playMedia(media) : media.pause();
      break;

    case "toggleMute":
      if (media.muted || media.volume === 0) {
        media.muted = false;
        media.volume = Math.max(advancedSettings.volumeStep, media.volume);
      } else {
        media.muted = true;
      }
      break;

    case "toggleOverlays":
      toggleOverlayVisibility();
      break;

    case "toggleFullscreen":
      if (media instanceof HTMLVideoElement) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          const fullscreenHost = getFullscreenHost(media);
          if (!fullscreenHost) {
            media.requestFullscreen();
            break;
          }

          void fullscreenHost.requestFullscreen().catch(() => {
            if (document.fullscreenElement !== fullscreenHost) {
              unwrapManagedFullscreenMedia();
            }
          });
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
      media.volume = Math.min(1, getEffectiveVolume(media) + advancedSettings.volumeStep);
      media.muted = false;
      break;

    case "volumeDown":
      media.volume = Math.max(0, getEffectiveVolume(media) - advancedSettings.volumeStep);
      media.muted = false;
      break;

    case "seekForwardSmall":
      media.currentTime += advancedSettings.seekStepSmall;
      break;

    case "seekBackwardSmall":
      media.currentTime -= advancedSettings.seekStepSmall;
      break;

    case "seekForwardMedium":
      media.currentTime += advancedSettings.seekStepMedium;
      break;

    case "seekBackwardMedium":
      media.currentTime -= advancedSettings.seekStepMedium;
      break;

    case "seekForwardLarge":
      media.currentTime += advancedSettings.seekStepLarge;
      break;

    case "seekBackwardLarge":
      media.currentTime -= advancedSettings.seekStepLarge;
      break;

    case "restart":
      media.currentTime = 0;
      break;

    case "speedUp":
      media.playbackRate = Math.min(
        advancedSettings.speedMax,
        media.playbackRate + advancedSettings.speedStep,
      );
      break;

    case "slowDown":
      media.playbackRate = Math.max(
        advancedSettings.speedMin,
        media.playbackRate - advancedSettings.speedStep,
      );
      break;

    default: {
      const percentMatch = action.match(/^seekToPercent(\d+)$/);
      if (percentMatch && media.duration) {
        const percent = parseInt(percentMatch[1], 10) / 100;
        media.currentTime = media.duration * percent;
      }
    }
  }

  const actionConfig = isConfigurableMediaAction(action)
    ? settings.quickSettings.actionKeyBindings[action]
    : { keys: [] };
  const overlaySettings = resolveActionOverlaySettings(action, actionConfig, advancedSettings);
  if (overlaySettings.overlayVisible) {
    showActionOverlay(
      action,
      media,
      overlaySettings.overlayPosition,
      advancedSettings,
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
  if (!settings.quickSettings.hotkeysEnabled) {
    return false;
  }

  if (isGlobalAction(action)) {
    return handleGlobalAction(action);
  }

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
  return normalizeHotkeyKey(e.key);
}

function getActionForKey(key: string): MediaAction | undefined {
  const action = keyToActionMap.get(key);
  if (action) {
    return action;
  }

  if (settings.advancedSettings.useNumberKeysToJump) {
    return NUMBER_KEY_ACTIONS[key];
  }

  return undefined;
}

function hasReservedModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.altKey || e.ctrlKey;
}

async function handleKeyDown(e: KeyboardEvent): Promise<void> {
  if (!settings.quickSettings.hotkeysEnabled) return;
  if (isEditableTarget(document.activeElement)) return;
  if (hasReservedModifier(e)) return;

  const key = getKeyString(e);
  const action = getActionForKey(key);
  if (!action) return;

  debugLog("Matched keydown to action", undefined, { action, key });

  e.preventDefault();
  e.stopPropagation();

  if (isGlobalAction(action)) {
    await handleGlobalAction(action);
    return;
  }

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
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("keydown", handleKeyDown, true);
initializeDynamicMediaTracking();
void loadSettings();

// #endregion
