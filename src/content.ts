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

type PlayablePlaceholderCandidate = {
  element: HTMLElement;
  clickTarget: HTMLElement;
  clickPoint: { x: number; y: number };
  durationCount: number;
  playControl: Element | null;
  rect: DOMRect;
  score: number;
  visibleArea: number;
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
const CLICKABLE_PLACEHOLDER_SELECTOR =
  'button, a[href], [role="button"], [role="link"], [tabindex], [onclick]';
const PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS = 900;
const PLACEHOLDER_ACTIVATION_POLL_MS = 50;
const PLACEHOLDER_MIN_WIDTH_PX = 96;
const PLACEHOLDER_MIN_HEIGHT_PX = 54;
const PLACEHOLDER_MIN_VISIBLE_AREA_PX = 96 * 54;
const DURATION_TEXT_PATTERN = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;

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

function isTargetableMediaElement(media: HTMLMediaElement): boolean {
  // If a video doesn't have controls and is muted (or defaults to muted),
  // then it may be an ambient video rather than primary content.
  // TODO: Test with custom video players to ensure this doesn't cause false negatives
  if (media instanceof HTMLVideoElement && !media.controls && (media.muted || media.defaultMuted)) {
    return false;
  }

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

function isElementVisible(element: Element, rect: DOMRect): boolean {
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

function getVisibleViewportArea(rect: DOMRect): number {
  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
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
      isTargetableMediaElement(node)
    ) {
      results.push(node);
    } else if (node instanceof Element && node.shadowRoot) {
      results.push(...findMedia(node.shadowRoot));
    }
    node = walker.nextNode();
  }

  return results;
}

function isDurationText(value: string): boolean {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return false;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes >= 0 && seconds >= 0 && seconds < 60;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours >= 0 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60;
  }

  return false;
}

function countDurationTexts(text: string): number {
  return (text.match(DURATION_TEXT_PATTERN) ?? []).filter(isDurationText).length;
}

function isWithinEditableElement(element: Element): boolean {
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

function getElementCenter(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getCenterDistanceRatio(elementRect: DOMRect, containerRect: DOMRect): number {
  const elementCenter = getElementCenter(elementRect);
  const containerCenter = getElementCenter(containerRect);
  const horizontalDistance = Math.abs(elementCenter.x - containerCenter.x) / containerRect.width;
  const verticalDistance = Math.abs(elementCenter.y - containerCenter.y) / containerRect.height;

  return Math.max(horizontalDistance, verticalDistance);
}

function isPlayLabeledElement(element: Element): boolean {
  const text = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("aria-description"),
    element.textContent,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return /\b(play|watch)\b/.test(text);
}

function findSemanticPlayControl(element: HTMLElement): Element | null {
  const controls = [
    element,
    ...Array.from(element.querySelectorAll(CLICKABLE_PLACEHOLDER_SELECTOR)),
  ];

  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    if (!isElementVisible(control, rect) || getVisibleViewportArea(rect) <= 0) {
      continue;
    }

    if (isPlayLabeledElement(control)) {
      return control;
    }
  }

  return null;
}

function isCenteredOverlaySvg(svg: SVGElement, containerRect: DOMRect): boolean {
  const rect = svg.getBoundingClientRect();
  if (!isElementVisible(svg, rect) || getVisibleViewportArea(rect) <= 0) {
    return false;
  }

  if (rect.width < 24 || rect.width > 180 || rect.height < 20 || rect.height > 180) {
    return false;
  }

  return getCenterDistanceRatio(rect, containerRect) <= 0.28;
}

function findPlayLikeControl(element: HTMLElement, containerRect: DOMRect): Element | null {
  const semanticControl = findSemanticPlayControl(element);
  if (semanticControl) {
    return semanticControl;
  }

  for (const svg of element.querySelectorAll("svg")) {
    if (isCenteredOverlaySvg(svg, containerRect)) {
      return svg;
    }
  }

  return null;
}

function hasThumbnailAspect(rect: DOMRect): boolean {
  const ratio = rect.width / rect.height;
  return ratio >= 1.2 && ratio <= 2.4;
}

function hasOwnThumbnailVisual(element: HTMLElement, rect: DOMRect): boolean {
  if (element instanceof HTMLImageElement || element.tagName.toLowerCase() === "picture") {
    return true;
  }

  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.backgroundImage && computedStyle.backgroundImage !== "none") {
    return true;
  }

  return hasThumbnailAspect(rect);
}

function hasLargeThumbnailDescendant(element: HTMLElement, containerRect: DOMRect): boolean {
  for (const descendant of element.querySelectorAll("img, picture, [style]")) {
    if (!(descendant instanceof HTMLElement)) {
      continue;
    }

    const rect = descendant.getBoundingClientRect();
    if (!isElementVisible(descendant, rect) || getVisibleViewportArea(rect) <= 0) {
      continue;
    }

    const computedStyle = window.getComputedStyle(descendant);
    const hasVisual =
      descendant instanceof HTMLImageElement ||
      descendant.tagName.toLowerCase() === "picture" ||
      (computedStyle.backgroundImage && computedStyle.backgroundImage !== "none");

    if (!hasVisual) {
      continue;
    }

    const containerArea = containerRect.width * containerRect.height;
    const descendantArea = rect.width * rect.height;
    const centerDistanceRatio = getCenterDistanceRatio(rect, containerRect);
    if (containerArea > 0 && descendantArea / containerArea >= 0.4 && centerDistanceRatio <= 0.2) {
      return true;
    }
  }

  return false;
}

function hasThumbnailVisual(element: HTMLElement, rect: DOMRect): boolean {
  return hasOwnThumbnailVisual(element, rect) || hasLargeThumbnailDescendant(element, rect);
}

function hasClickableSignal(element: HTMLElement): boolean {
  if (element.matches(CLICKABLE_PLACEHOLDER_SELECTOR)) {
    return true;
  }

  if (window.getComputedStyle(element).cursor === "pointer") {
    return true;
  }

  return Boolean(element.querySelector(CLICKABLE_PLACEHOLDER_SELECTOR));
}

function findPreferredClickableAncestor(start: Element, boundary: HTMLElement): HTMLElement | null {
  let current: Element | null = start;

  while (current && boundary.contains(current)) {
    if (current instanceof HTMLElement) {
      const isClickable =
        current.matches(CLICKABLE_PLACEHOLDER_SELECTOR) ||
        window.getComputedStyle(current).cursor === "pointer";
      if (isClickable) {
        return current;
      }
    }

    if (current === boundary) {
      break;
    }

    current = current.parentElement;
  }

  return null;
}

function resolvePlaceholderClickTarget(
  element: HTMLElement,
  playControl: Element | null,
  clickPoint: { x: number; y: number },
): HTMLElement {
  const preferredStart = playControl ?? element;
  const clickableAncestor = findPreferredClickableAncestor(preferredStart, element);
  if (clickableAncestor) {
    return clickableAncestor;
  }

  const pointTarget = document.elementFromPoint?.(clickPoint.x, clickPoint.y);
  if (pointTarget instanceof HTMLElement && element.contains(pointTarget)) {
    return findPreferredClickableAncestor(pointTarget, element) ?? pointTarget;
  }

  return element;
}

function scorePlayablePlaceholderCandidate(
  element: HTMLElement,
  visibleArea: number,
  durationCount: number,
  playControl: Element | null,
  hasThumbnail: boolean,
): number {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const areaScore = Math.min(40, (visibleArea / viewportArea) * 100);
  const durationScore = Math.min(durationCount, 3) * 25;
  const playControlScore = playControl ? 45 : 0;
  const thumbnailScore = hasThumbnail ? 25 : 0;
  const clickableScore = hasClickableSignal(element) ? 15 : 0;

  return areaScore + durationScore + playControlScore + thumbnailScore + clickableScore;
}

function getPlayablePlaceholderCandidate(
  element: HTMLElement,
): PlayablePlaceholderCandidate | null {
  if (element === document.body || element === document.documentElement) {
    return null;
  }

  if (isWithinEditableElement(element)) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (!isElementVisible(element, rect)) {
    return null;
  }

  if (rect.width < PLACEHOLDER_MIN_WIDTH_PX || rect.height < PLACEHOLDER_MIN_HEIGHT_PX) {
    return null;
  }

  const visibleArea = getVisibleViewportArea(rect);
  if (visibleArea < PLACEHOLDER_MIN_VISIBLE_AREA_PX) {
    return null;
  }

  if (findMedia(element).some(isTargetableMediaElement)) {
    return null;
  }

  const durationCount = countDurationTexts(element.textContent ?? "");
  if (durationCount === 0 || durationCount > 3) {
    return null;
  }

  const playControl = findPlayLikeControl(element, rect);
  const hasThumbnail = hasThumbnailVisual(element, rect);
  if (!playControl && !hasThumbnail) {
    return null;
  }

  const clickRect = playControl?.getBoundingClientRect() ?? rect;
  const clickPoint = getElementCenter(clickRect);
  const clickTarget = resolvePlaceholderClickTarget(element, playControl, clickPoint);

  return {
    element,
    clickTarget,
    clickPoint,
    durationCount,
    playControl,
    rect,
    score: scorePlayablePlaceholderCandidate(
      element,
      visibleArea,
      durationCount,
      playControl,
      hasThumbnail,
    ),
    visibleArea,
  };
}

function collectPlayablePlaceholderCandidates(
  root: Document | ShadowRoot | Element,
): PlayablePlaceholderCandidate[] {
  const candidates: PlayablePlaceholderCandidate[] = [];
  const walker = document.createTreeWalker(
    root instanceof Document ? root.documentElement : root,
    NodeFilter.SHOW_ELEMENT,
  );

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof HTMLElement) {
      const candidate = getPlayablePlaceholderCandidate(node);
      if (candidate) {
        candidates.push(candidate);
      }

      if (node.shadowRoot) {
        candidates.push(...collectPlayablePlaceholderCandidates(node.shadowRoot));
      }
    }

    node = walker.nextNode();
  }

  return candidates;
}

function findBestPlayablePlaceholder(): PlayablePlaceholderCandidate | null {
  const candidates = collectPlayablePlaceholderCandidates(document);
  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.visibleArea - left.visibleArea;
  });

  return candidates[0] ?? null;
}

function waitForTargetMedia(timeoutMs: number): Promise<HTMLMediaElement | null> {
  const immediateMedia = getTargetMedia();
  if (immediateMedia) {
    return Promise.resolve(immediateMedia);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      const media = getTargetMedia();
      if (media) {
        window.clearInterval(intervalId);
        resolve(media);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(intervalId);
        resolve(null);
      }
    }, PLACEHOLDER_ACTIVATION_POLL_MS);
  });
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
 * 1. Active element (if it's a supported, non-ambient media type)
 * 2. Currently playing non-ambient media
 * 3. Most recently interacted non-ambient media
 * 4. First supported non-ambient media on page
 * @returns {HTMLMediaElement|null}
 */
export function getTargetMedia(): HTMLMediaElement | null {
  // 1. Active element
  const focused = document.activeElement;
  if (
    (focused instanceof HTMLVideoElement || focused instanceof HTMLAudioElement) &&
    isTargetableMediaElement(focused)
  ) {
    return focused as HTMLMediaElement;
  }

  const mediaList = findMedia(document).filter(isTargetableMediaElement);
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
    isTargetableMediaElement(lastInteractedMedia)
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
      isTargetableMediaElement(node)
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

type PlayerBridgeCommandName =
  | "play"
  | "pause"
  | "setMuted"
  | "readMuted"
  | "setVolume"
  | "readVolume"
  | "setCurrentTime"
  | "readCurrentTime"
  | "readDuration"
  | "setPlaybackRate"
  | "readPlaybackRate"
  | "requestFullscreen";

type PlayerBridgeResponse = {
  id: string;
  handled: boolean;
  value?: unknown;
};

const PLAYER_BRIDGE_EVENT = "media-hotkeys-player-bridge-command";
const PLAYER_BRIDGE_COMMAND_ATTR = "data-media-hotkeys-player-command";
const PLAYER_BRIDGE_RESPONSE_ATTR = "data-media-hotkeys-player-response";

let playerBridgeRequestCounter = 0;

function getCustomMediaHost(media: HTMLMediaElement): HTMLElement | null {
  const root = media.getRootNode();
  if (!(root instanceof ShadowRoot)) {
    return null;
  }

  return root.host instanceof HTMLElement && root.host.tagName.includes("-") ? root.host : null;
}

function requestPlayerBridge(
  host: HTMLElement,
  command: PlayerBridgeCommandName,
  value?: boolean | number,
): PlayerBridgeResponse | null {
  const id = `${Date.now()}-${playerBridgeRequestCounter++}`;

  try {
    host.removeAttribute(PLAYER_BRIDGE_RESPONSE_ATTR);
    host.setAttribute(PLAYER_BRIDGE_COMMAND_ATTR, JSON.stringify({ id, command, value }));
    host.dispatchEvent(new CustomEvent(PLAYER_BRIDGE_EVENT));

    const rawResponse = host.getAttribute(PLAYER_BRIDGE_RESPONSE_ATTR);
    if (!rawResponse) {
      return null;
    }

    const response: unknown = JSON.parse(rawResponse);
    if (
      !response ||
      typeof response !== "object" ||
      (response as Partial<PlayerBridgeResponse>).id !== id ||
      typeof (response as Partial<PlayerBridgeResponse>).handled !== "boolean"
    ) {
      return null;
    }

    return response as PlayerBridgeResponse;
  } catch {
    return null;
  } finally {
    host.removeAttribute(PLAYER_BRIDGE_COMMAND_ATTR);
    host.removeAttribute(PLAYER_BRIDGE_RESPONSE_ATTR);
  }
}

function getHostMember(host: HTMLElement, memberName: string): unknown {
  return (host as unknown as Record<string, unknown>)[memberName];
}

function tryDirectHostMethodSync(host: HTMLElement, methodName: string): boolean {
  const method = getHostMember(host, methodName);
  if (typeof method !== "function") {
    return false;
  }

  try {
    void method.call(host);
    return true;
  } catch {
    return false;
  }
}

function tryBridgeMethod(host: HTMLElement, command: PlayerBridgeCommandName): boolean {
  return requestPlayerBridge(host, command)?.handled ?? false;
}

function readDirectHostBoolean(host: HTMLElement, propertyName: string): boolean | null {
  if (!(propertyName in host)) {
    return null;
  }

  const value = getHostMember(host, propertyName);
  return typeof value === "boolean" ? value : null;
}

function readDirectHostNumber(host: HTMLElement, propertyName: string): number | null {
  if (!(propertyName in host)) {
    return null;
  }

  const value = getHostMember(host, propertyName);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBridgeBoolean(host: HTMLElement, command: PlayerBridgeCommandName): boolean | null {
  const response = requestPlayerBridge(host, command);
  return response?.handled === true && typeof response.value === "boolean" ? response.value : null;
}

function readBridgeNumber(host: HTMLElement, command: PlayerBridgeCommandName): number | null {
  const response = requestPlayerBridge(host, command);
  return response?.handled === true &&
    typeof response.value === "number" &&
    Number.isFinite(response.value)
    ? response.value
    : null;
}

function setDirectHostProperty(
  host: HTMLElement,
  propertyName: string,
  value: boolean | number,
): boolean {
  if (!(propertyName in host)) {
    return false;
  }

  try {
    (host as unknown as Record<string, boolean | number>)[propertyName] = value;
    return true;
  } catch {
    return false;
  }
}

function setBridgeProperty(
  host: HTMLElement,
  command: PlayerBridgeCommandName,
  value: boolean | number,
): boolean {
  return requestPlayerBridge(host, command, value)?.handled ?? false;
}

function readCustomPlayerBoolean(
  media: HTMLMediaElement,
  propertyName: string,
  command: PlayerBridgeCommandName,
): boolean | null {
  const host = getCustomMediaHost(media);
  if (!host) {
    return null;
  }

  return readDirectHostBoolean(host, propertyName) ?? readBridgeBoolean(host, command);
}

function readCustomPlayerNumber(
  media: HTMLMediaElement,
  propertyName: string,
  command: PlayerBridgeCommandName,
): number | null {
  const host = getCustomMediaHost(media);
  if (!host) {
    return null;
  }

  return readDirectHostNumber(host, propertyName) ?? readBridgeNumber(host, command);
}

function setCustomPlayerProperty(
  media: HTMLMediaElement,
  propertyName: string,
  command: PlayerBridgeCommandName,
  value: boolean | number,
): boolean {
  const host = getCustomMediaHost(media);
  if (!host) {
    return false;
  }

  return (
    setDirectHostProperty(host, propertyName, value) || setBridgeProperty(host, command, value)
  );
}

function tryCustomPlayerMethodSync(
  media: HTMLMediaElement,
  methodName: string,
  command: PlayerBridgeCommandName,
): boolean {
  const host = getCustomMediaHost(media);
  if (!host) {
    return false;
  }

  return tryDirectHostMethodSync(host, methodName) || tryBridgeMethod(host, command);
}

function clickShadowPlayButton(media: HTMLMediaElement): boolean {
  const root = media.getRootNode();
  const host = getCustomMediaHost(media);
  if (!host || !(root instanceof DocumentFragment)) {
    return false;
  }

  debugLog("Attempting to find and click play button within media host element", media, {
    customElement: host,
  });

  for (const button of root.querySelectorAll("button")) {
    if (
      button.innerText.toLowerCase().includes("play") ||
      button.getAttribute("aria-label")?.toLowerCase().includes("play")
    ) {
      debugLog("Found button with 'play' in the label. Clicking it...", media, { button });
      button.click();
      return true;
    }
  }

  return false;
}

async function tryPlayMedia(media: HTMLMediaElement): Promise<void> {
  try {
    const host = getCustomMediaHost(media);
    if (host) {
      debugLog("Attempting to play media in a web component", media, { customElement: host });

      const play = getHostMember(host, "play");
      if (typeof play === "function") {
        try {
          await play.call(host);
          return;
        } catch {
          // Fall back to the bridge, play-button click, then native media playback.
        }
      }

      if (tryBridgeMethod(host, "play")) {
        return;
      }

      clickShadowPlayButton(media);
    }

    await media.play();
  } catch {
    // Ignore play() rejections. The extension invokes playback as a best-effort
    // action, and pages can legitimately block it due to autoplay policies.
  }
}

function playMedia(media: HTMLMediaElement): void {
  void tryPlayMedia(media);
}

async function activatePlayablePlaceholder(action: MediaAction): Promise<boolean> {
  if (action !== "togglePlayPause") {
    return false;
  }

  const candidate = findBestPlayablePlaceholder();
  if (!candidate) {
    return false;
  }

  debugLog("Activating playable placeholder", undefined, {
    clickTargetTagName: candidate.clickTarget.tagName,
    durationCount: candidate.durationCount,
    score: candidate.score,
  });

  candidate.clickTarget.click();

  const media = await waitForTargetMedia(PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS);
  if (media?.paused) {
    trackInteraction(media, "placeholder:play");
    playMedia(media);
  }

  return true;
}

function handleLocalTargetMediaAction(action: MediaAction): boolean {
  const media = getTargetMedia();
  if (media) {
    handleAction(action, media);
    return true;
  }

  return false;
}

async function handleLocalMediaAction(action: MediaAction): Promise<boolean> {
  if (handleLocalTargetMediaAction(action)) {
    return true;
  }

  return activatePlayablePlaceholder(action);
}

function pauseMedia(media: HTMLMediaElement): void {
  if (tryCustomPlayerMethodSync(media, "pause", "pause")) {
    return;
  }

  media.pause();
}

function getEffectiveVolume(media: HTMLMediaElement): number {
  return readPlayerMuted(media) ? 0 : readPlayerVolume(media);
}

function readPlayerMuted(media: HTMLMediaElement): boolean {
  return readCustomPlayerBoolean(media, "muted", "readMuted") ?? media.muted;
}

function setPlayerMuted(media: HTMLMediaElement, muted: boolean): void {
  if (setCustomPlayerProperty(media, "muted", "setMuted", muted)) {
    return;
  }

  media.muted = muted;
}

function readPlayerVolume(media: HTMLMediaElement): number {
  const volume = readCustomPlayerNumber(media, "volume", "readVolume");
  return typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : media.volume;
}

function setPlayerVolume(media: HTMLMediaElement, volume: number): void {
  const clampedVolume = Math.min(1, Math.max(0, volume));
  if (setCustomPlayerProperty(media, "volume", "setVolume", clampedVolume)) {
    return;
  }

  media.volume = clampedVolume;
}

function readPlayerCurrentTime(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "currentTime", "readCurrentTime") ?? media.currentTime;
}

function setPlayerCurrentTime(media: HTMLMediaElement, currentTime: number): void {
  if (setCustomPlayerProperty(media, "currentTime", "setCurrentTime", currentTime)) {
    return;
  }

  media.currentTime = currentTime;
}

function readPlayerDuration(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "duration", "readDuration") ?? media.duration;
}

function readPlayerPlaybackRate(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "playbackRate", "readPlaybackRate") ?? media.playbackRate;
}

function setPlayerPlaybackRate(media: HTMLMediaElement, playbackRate: number): void {
  if (setCustomPlayerProperty(media, "playbackRate", "setPlaybackRate", playbackRate)) {
    return;
  }

  media.playbackRate = playbackRate;
}

function requestCustomPlayerFullscreen(media: HTMLMediaElement): boolean {
  const host = getCustomMediaHost(media);
  if (!host) {
    return false;
  }

  return (
    tryBridgeMethod(host, "requestFullscreen") || tryDirectHostMethodSync(host, "requestFullscreen")
  );
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
      media.paused ? playMedia(media) : pauseMedia(media);
      break;

    case "toggleMute":
      if (readPlayerMuted(media) || readPlayerVolume(media) === 0) {
        setPlayerMuted(media, false);
        setPlayerVolume(media, Math.max(advancedSettings.volumeStep, readPlayerVolume(media)));
      } else {
        setPlayerMuted(media, true);
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
          if (requestCustomPlayerFullscreen(media)) {
            break;
          }

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
      setPlayerVolume(media, Math.min(1, getEffectiveVolume(media) + advancedSettings.volumeStep));
      setPlayerMuted(media, false);
      break;

    case "volumeDown":
      setPlayerVolume(media, Math.max(0, getEffectiveVolume(media) - advancedSettings.volumeStep));
      setPlayerMuted(media, false);
      break;

    case "seekForwardSmall":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) + advancedSettings.seekStepSmall);
      break;

    case "seekBackwardSmall":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) - advancedSettings.seekStepSmall);
      break;

    case "seekForwardMedium":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) + advancedSettings.seekStepMedium);
      break;

    case "seekBackwardMedium":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) - advancedSettings.seekStepMedium);
      break;

    case "seekForwardLarge":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) + advancedSettings.seekStepLarge);
      break;

    case "seekBackwardLarge":
      setPlayerCurrentTime(media, readPlayerCurrentTime(media) - advancedSettings.seekStepLarge);
      break;

    case "restart":
      setPlayerCurrentTime(media, 0);
      break;

    case "speedUp":
      setPlayerPlaybackRate(
        media,
        Math.min(
          advancedSettings.speedMax,
          readPlayerPlaybackRate(media) + advancedSettings.speedStep,
        ),
      );
      break;

    case "slowDown":
      setPlayerPlaybackRate(
        media,
        Math.max(
          advancedSettings.speedMin,
          readPlayerPlaybackRate(media) - advancedSettings.speedStep,
        ),
      );
      break;

    default: {
      const percentMatch = action.match(/^seekToPercent(\d+)$/);
      const duration = readPlayerDuration(media);
      if (percentMatch && duration) {
        const percent = parseInt(percentMatch[1], 10) / 100;
        setPlayerCurrentTime(media, duration * percent);
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

  if (handleLocalTargetMediaAction(action)) {
    return true;
  }

  if (await delegateActionToChildFrames(action)) {
    return true;
  }

  return activatePlayablePlaceholder(action);
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

  if (!(await handleLocalMediaAction(action))) {
    debugLog("No media element found for action", undefined, { action, key });
  }
}

// #endregion

// #region Initialization

window.addEventListener("message", handleFrameMessage);
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("keydown", handleKeyDown, true);
initializeDynamicMediaTracking();
void loadSettings();

// #endregion
