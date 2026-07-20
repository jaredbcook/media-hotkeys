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

const CLICKABLE_PLACEHOLDER_SELECTOR =
  'button, a[href], [role="button"], [role="link"], [tabindex], [onclick]';
const PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS = 900;
const PLACEHOLDER_ACTIVATION_POLL_MS = 50;
const PLACEHOLDER_MIN_WIDTH_PX = 96;
const PLACEHOLDER_MIN_HEIGHT_PX = 54;
const PLACEHOLDER_MIN_VISIBLE_AREA_PX = 96 * 54;
const DURATION_TEXT_PATTERN = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;

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

  candidate.clickTarget.click();

  const media = await waitForTargetMedia(PLACEHOLDER_ACTIVATION_MEDIA_WAIT_MS);
  if (media?.paused) {
    trackInteraction(media, "placeholder:play");
    playMedia(media);
  }

  return true;
}
