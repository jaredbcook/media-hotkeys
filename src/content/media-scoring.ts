import { getVisibleViewportArea, isElementVisible } from "./dom-utils.js";
import { findMedia, isAmbientMediaElement } from "./media-discovery.js";
import { isPointerOverRect } from "./media-tracking.js";
import { actionedMedia, state } from "./state.js";

export type ScoredMedia = {
  media: HTMLMediaElement;
  score: number;
  // The visible-area component of `score`, reported separately so a parent
  // frame can rescale it by how much of its own viewport the iframe covers.
  areaScore: number;
};

// Weighted-scoring signal values. The exact numbers matter less than their
// relative ordering: user intent (fullscreen/PiP/focus) > audible playback >
// recent interaction > muted playback > visual prominence > weak hints.
const SCORE_FULLSCREEN_OR_PIP = 1000;
const SCORE_FOCUSED = 800;
const SCORE_PLAYING_AUDIBLE = 500;
const SCORE_PLAYING_MUTED = 150;
const SCORE_LAST_INTERACTED = 300;
const SCORE_LAST_ACTIONED = 200;
const SCORE_POINTER_OVER = 120;
const SCORE_MAX_VISIBLE_AREA = 200;
const SCORE_HAS_CONTROLS = 30;
const SCORE_AUDIO_BASE = 20;
const SCORE_NON_AMBIENT_BASE = 10;
const SCORE_AMBIENT_PENALTY = -250;
// At or above this local score (focus, fullscreen, or PiP), skip cross-frame
// arbitration entirely — the user's intent is unambiguous.
export const STRONG_LOCAL_TARGET_SCORE = 800;

function isMediaPlaying(media: HTMLMediaElement): boolean {
  // Stalled playback (buffering) drops readyState to HAVE_CURRENT_DATA or
  // HAVE_METADATA while the media is still logically playing; users often
  // press keys exactly then, so only require metadata (readyState >= 1).
  return !media.paused && !media.ended && media.readyState >= 1;
}

function isMediaAudible(media: HTMLMediaElement): boolean {
  return isMediaPlaying(media) && !media.muted && media.volume > 0;
}

function scoreMediaCandidate(media: HTMLMediaElement): { score: number; areaScore: number } {
  let score = 0;
  let areaScore = 0;
  let isPointerOver = false;

  const fullscreenElement = document.fullscreenElement;
  if (fullscreenElement && (fullscreenElement === media || fullscreenElement.contains(media))) {
    score += SCORE_FULLSCREEN_OR_PIP;
  }

  if ("pictureInPictureElement" in document && document.pictureInPictureElement === media) {
    score += SCORE_FULLSCREEN_OR_PIP;
  }

  if (document.activeElement === media) {
    score += SCORE_FOCUSED;
  }

  if (isMediaPlaying(media)) {
    score += isMediaAudible(media) ? SCORE_PLAYING_AUDIBLE : SCORE_PLAYING_MUTED;
  }

  if (media === state.lastInteractedMedia) {
    score += SCORE_LAST_INTERACTED;
  }

  if (media === state.lastActionedMedia) {
    score += SCORE_LAST_ACTIONED;
  }

  if (media instanceof HTMLVideoElement) {
    const rect = media.getBoundingClientRect();
    if (isElementVisible(media, rect)) {
      const viewportArea = window.innerWidth * window.innerHeight;
      if (viewportArea > 0) {
        const visibleFraction = Math.min(1, getVisibleViewportArea(rect) / viewportArea);
        areaScore = Math.round(SCORE_MAX_VISIBLE_AREA * visibleFraction);
        score += areaScore;
      }

      isPointerOver = isPointerOverRect(rect);
    }
  } else {
    // Audio has no visual footprint, so give it a modest stand-in for area.
    score += SCORE_AUDIO_BASE;
  }

  if (media.controls) {
    score += SCORE_HAS_CONTROLS;
  }

  // Ambient-looking media (muted video without controls) is penalized rather
  // than excluded: strong signals such as playback, interaction history, or a
  // large visible area can still lift it above the targetability threshold.
  // Media the extension already acted on keeps its standing.
  if (isAmbientMediaElement(media) && !actionedMedia.has(media)) {
    score += SCORE_AMBIENT_PENALTY;
  } else {
    score += SCORE_NON_AMBIENT_BASE;
    // Hovering is a weak but common way of pointing at the intended player
    // before pressing a key. Ambient media gets no credit: resting the mouse
    // over a background hero video says nothing about wanting to control it.
    if (isPointerOver) {
      score += SCORE_POINTER_OVER;
    }
  }

  return { score, areaScore };
}

/**
 * Scores every valid-source media element in this frame and returns the
 * highest-scoring one. Candidates must score above zero to be targetable, so
 * an idle ambient background video is never selected on its own.
 * Ties resolve to the earliest element in DOM order.
 */
export function getBestLocalCandidate(): ScoredMedia | null {
  let best: ScoredMedia | null = null;

  for (const media of findMedia(document)) {
    const { score, areaScore } = scoreMediaCandidate(media);
    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { media, score, areaScore };
    }
  }

  return best;
}

export function getTargetMedia(): HTMLMediaElement | null {
  return getBestLocalCandidate()?.media ?? null;
}
