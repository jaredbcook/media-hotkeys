import type { MediaAction } from "../storage.js";
import {
  debugLog,
  getVisibleViewportArea,
  isElementVisible,
  isWithinEditableElement,
} from "./dom-utils.js";
import { findMedia, isTargetableMediaElement } from "./media-discovery.js";
import { getTargetMedia } from "./media-scoring.js";
import { trackInteraction } from "./media-tracking.js";
import { playMedia } from "./player-control.js";

type PlayControlKind = "labeled" | "classed" | "icon";

type PlayControl = {
  element: Element;
  kind: PlayControlKind;
};

type PlayablePlaceholderCandidate = {
  element: HTMLElement;
  clickTarget: HTMLElement;
  clickPoint: { x: number; y: number };
  durationCount: number;
  leavesPage: boolean;
  playControl: Element | null;
  rect: DOMRect;
  score: number;
  visibleArea: number;
};

const CLICKABLE_PLACEHOLDER_SELECTOR =
  'button, a[href], [role="button"], [role="link"], [tabindex], [onclick]';
const PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS = 900;
const PLACEHOLDER_ACTIVATION_POLL_MS = 50;
const PLACEHOLDER_MIN_WIDTH_PX = 96;
const PLACEHOLDER_MIN_HEIGHT_PX = 54;
const PLACEHOLDER_MIN_VISIBLE_AREA_PX = 96 * 54;
const DURATION_TEXT_PATTERN = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
// Longest visible text treated as a control's label. Players commonly put the
// accessible name in visually hidden text (lite-youtube's "Play", Video.js's
// "Play Video") rather than aria-label; longer text is content, not a label.
const MAX_TEXT_LABEL_LENGTH = 60;
// "Play" in the languages players most often localize their big play button
// to. "Watch" is deliberately excluded: on real pages it labels navigation
// links ("Watch on YouTube", "Watch later") far more often than play buttons.
const PLAY_LABEL_PATTERN =
  /(?:^|[^\p{L}])(?:play|reproducir|reproduzir|lire|abspielen|wiedergeben|riproduci|afspelen|odtwórz|spela|toista|přehrát|воспроизвести|oynat)(?!\p{L})|再生|播放|재생/iu;
// Class-name conventions for big play overlays: "vjs-big-play-button",
// "ytp-large-play-button", "lty-playbtn", "mejs__overlay-play", WP Rocket's
// ".play". Excludes "player", "playlist", "display", "autoplay", "playing".
const PLAY_CLASS_PATTERN = /(?:^|[^a-z])play(?![a-z])|play[-_]?(?:btn|button|icon)/i;

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

function getAriaLabelledByText(element: Element): string | null {
  const ids = element.getAttribute("aria-labelledby")?.trim();
  if (!ids) {
    return null;
  }

  const root = element.getRootNode();
  const lookupRoot = root instanceof Document || root instanceof ShadowRoot ? root : document;
  return ids
    .split(/\s+/)
    .map((id) => lookupRoot.getElementById(id)?.textContent?.trim() ?? "")
    .join(" ");
}

/**
 * Approximates the element's accessible name. Visible text is only included
 * when asked for (controls) and when short enough to be a label, so a whole
 * card's text content never reads as a "play" label.
 */
function getElementLabel(element: Element, includeText: boolean): string {
  const parts = [
    element.getAttribute("aria-label"),
    getAriaLabelledByText(element),
    element.getAttribute("title"),
  ];

  if (includeText) {
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= MAX_TEXT_LABEL_LENGTH) {
      parts.push(text);
    }
  }

  return parts.filter((value): value is string => Boolean(value)).join(" ");
}

function isPlayLabeledElement(element: Element, includeText: boolean): boolean {
  return PLAY_LABEL_PATTERN.test(getElementLabel(element, includeText));
}

function hasPlayClassName(element: Element): boolean {
  const className = element.getAttribute("class");
  return Boolean(className) && PLAY_CLASS_PATTERN.test(className ?? "");
}

/**
 * Whether the control unambiguously starts playback in place, strong enough
 * to qualify a placeholder that shows no duration text (YouTube's cued embed,
 * lite-youtube, WP Rocket's lazy YouTube): a button labeled "play", or a
 * centered overlay following the play-button class-name convention.
 */
function isExplicitPlayControl(control: PlayControl | null): boolean {
  if (!control) {
    return false;
  }

  if (control.kind === "classed") {
    return true;
  }

  return control.kind === "labeled" && control.element.matches('button, [role="button"]');
}

function findSemanticPlayControl(element: HTMLElement): Element | null {
  // The container itself only counts via its explicit label: its text
  // content is the whole card (titles, "Watch later", channel names).
  if (isPlayLabeledElement(element, false)) {
    return element;
  }

  for (const control of element.querySelectorAll(CLICKABLE_PLACEHOLDER_SELECTOR)) {
    const rect = control.getBoundingClientRect();
    if (!isElementVisible(control, rect) || getVisibleViewportArea(rect) <= 0) {
      continue;
    }

    if (isPlayLabeledElement(control, true)) {
      return control;
    }
  }

  return null;
}

function isCenteredOverlay(element: Element, containerRect: DOMRect): boolean {
  const rect = element.getBoundingClientRect();
  if (!isElementVisible(element, rect) || getVisibleViewportArea(rect) <= 0) {
    return false;
  }

  if (rect.width < 24 || rect.width > 180 || rect.height < 20 || rect.height > 180) {
    return false;
  }

  return getCenterDistanceRatio(rect, containerRect) <= 0.28;
}

function findPlayLikeControl(element: HTMLElement, containerRect: DOMRect): PlayControl | null {
  const semanticControl = findSemanticPlayControl(element);
  if (semanticControl) {
    return { element: semanticControl, kind: "labeled" };
  }

  for (const candidate of element.querySelectorAll("[class]")) {
    if (hasPlayClassName(candidate) && isCenteredOverlay(candidate, containerRect)) {
      return { element: candidate, kind: "classed" };
    }
  }

  for (const svg of element.querySelectorAll("svg")) {
    if (isCenteredOverlay(svg, containerRect)) {
      return { element: svg, kind: "icon" };
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

/**
 * Elements marked aria-disabled or natively disabled may still carry a
 * role/tabindex/click-selector match, but their own handlers typically no-op
 * on click. Never treat these as the real interactive target — sites often
 * wrap real controls in such a container for unrelated a11y/state reasons.
 */
function isDisabledElement(element: Element): boolean {
  if (element.getAttribute("aria-disabled") === "true") {
    return true;
  }

  return "disabled" in element && Boolean((element as { disabled?: boolean }).disabled);
}

function isClickableElement(element: HTMLElement): boolean {
  if (isDisabledElement(element)) {
    return false;
  }

  return (
    element.matches(CLICKABLE_PLACEHOLDER_SELECTOR) ||
    window.getComputedStyle(element).cursor === "pointer"
  );
}

function hasClickableSignal(element: HTMLElement): boolean {
  if (isClickableElement(element)) {
    return true;
  }

  return Array.from(element.querySelectorAll(CLICKABLE_PLACEHOLDER_SELECTOR)).some(
    (candidate) => candidate instanceof HTMLElement && !isDisabledElement(candidate),
  );
}

function findPreferredClickableAncestor(start: Element, boundary: HTMLElement): HTMLElement | null {
  let current: Element | null = start;

  while (current && boundary.contains(current)) {
    if (current instanceof HTMLElement && isClickableElement(current)) {
      return current;
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

function findEnclosingLink(element: Element): HTMLAnchorElement | HTMLAreaElement | null {
  let current: Element | null = element;

  while (current) {
    if (
      (current instanceof HTMLAnchorElement || current instanceof HTMLAreaElement) &&
      current.hasAttribute("href")
    ) {
      return current;
    }

    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }

  return null;
}

/** Resolves a link's destination if following it would leave this document. */
function getPageLeavingUrl(link: HTMLAnchorElement | HTMLAreaElement): URL | null {
  let url: URL;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return null;
  }

  if (url.protocol === "javascript:") {
    return null;
  }

  const current = new URL(window.location.href);
  const isSameDocument =
    url.origin === current.origin &&
    url.pathname === current.pathname &&
    url.search === current.search;
  return isSameDocument ? null : url;
}

/**
 * Whether clicking the target would navigate to another page on this site.
 * These are listing cards (YouTube search results, TED's talk grid, news
 * "more videos" rails), not in-place players. Pressing play must never
 * navigate away, and SPA routers intercept these clicks (preventDefault plus
 * history.pushState), so a post-click guard cannot stop them.
 */
function leadsToAnotherSitePage(clickTarget: Element): boolean {
  const link = findEnclosingLink(clickTarget);
  const url = link ? getPageLeavingUrl(link) : null;
  return url !== null && url.origin === window.location.origin;
}

/**
 * Clicks the placeholder but cancels any navigation the page itself did not
 * take over. Facades often wrap the thumbnail in a link to the provider
 * (e.g. youtube.com/watch) as a no-JS fallback and preventDefault in their
 * click handler; if nothing intercepts the click, following the link would
 * leave the page. Returns false when the click only would have navigated.
 */
function clickWithoutLeavingPage(target: HTMLElement): boolean {
  let cancelledNavigation = false;
  const cancelUnhandledNavigation = (event: Event): void => {
    if (event.defaultPrevented) {
      return;
    }

    const link = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement | HTMLAreaElement =>
          (node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) &&
          node.hasAttribute("href"),
      );
    if (link && getPageLeavingUrl(link)) {
      event.preventDefault();
      cancelledNavigation = true;
    }
  };

  // Registered last on window's bubble phase, so it runs after the page's own
  // handlers have had their chance to claim the click.
  window.addEventListener("click", cancelUnhandledNavigation);
  try {
    target.click();
  } finally {
    window.removeEventListener("click", cancelUnhandledNavigation);
  }

  return !cancelledNavigation;
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

  if (isDisabledElement(element)) {
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
  if (durationCount > 3) {
    return null;
  }

  const playControl = findPlayLikeControl(element, rect);
  const hasThumbnail = hasThumbnailVisual(element, rect);
  if (durationCount === 0) {
    // Duration-less embeds (YouTube's cued iframe player, lite-youtube) qualify
    // only with an unambiguous play control on top of a thumbnail visual.
    if (!isExplicitPlayControl(playControl) || !hasThumbnail) {
      return null;
    }
  } else if (!playControl && !hasThumbnail) {
    return null;
  }

  const playControlElement = playControl?.element ?? null;
  const clickRect = playControlElement?.getBoundingClientRect() ?? rect;
  const clickPoint = getElementCenter(clickRect);
  const clickTarget = resolvePlaceholderClickTarget(element, playControlElement, clickPoint);

  return {
    element,
    clickTarget,
    clickPoint,
    durationCount,
    leavesPage: leadsToAnotherSitePage(clickTarget),
    playControl: playControlElement,
    rect,
    score: scorePlayablePlaceholderCandidate(
      element,
      visibleArea,
      durationCount,
      playControlElement,
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

/**
 * Ancestors of a qualifying placeholder often qualify too: duration text and
 * thumbnail/play-control descendants are found via querySelector, so a broad
 * wrapper (e.g. an entire post/card) can "inherit" a nested placeholder's
 * signals and outscore it, even though the ancestor isn't the real click
 * target. Drop any candidate that contains another qualifying candidate,
 * keeping only the most specific (innermost) one(s) in each chain.
 */
function discardRedundantAncestorCandidates(
  candidates: PlayablePlaceholderCandidate[],
): PlayablePlaceholderCandidate[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && candidate.element.contains(other.element)),
  );
}

function findBestPlayablePlaceholder(): PlayablePlaceholderCandidate | null {
  // Page-leaving cards are dropped only after ancestor pruning, so a wrapper
  // around a link card cannot inherit its signals and get clicked instead.
  const candidates = discardRedundantAncestorCandidates(
    collectPlayablePlaceholderCandidates(document),
  ).filter((candidate) => !candidate.leavesPage);
  debugLog("Playable placeholder scan", undefined, {
    candidateCount: candidates.length,
    frameUrl: window.location.href,
  });
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

export async function activatePlayablePlaceholder(action: MediaAction): Promise<boolean> {
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

  if (!clickWithoutLeavingPage(candidate.clickTarget)) {
    debugLog("Cancelled placeholder click that would have left the page");
    return false;
  }

  const media = await waitForTargetMedia(PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS);
  if (media?.paused) {
    trackInteraction(media, "placeholder:play");
    playMedia(media);
  }

  return true;
}
