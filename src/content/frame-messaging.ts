import { type MediaAction, findMatchingSitePolicy } from "../storage.js";
import {
  ACTION_REQUEST_TYPE,
  ACTION_RESPONSE_TYPE,
  EXECUTE_PLACEHOLDER_TIMEOUT_MS,
  EXECUTE_ROUTE_TTL_MS,
  EXECUTE_TIMEOUT_MS,
  FRAME_ACTION_TIMEOUT_MS,
  MESSAGE_SOURCE,
  SCORE_CHILD_BUDGET_MARGIN_MS,
  SCORE_MIN_CHILD_BUDGET_MS,
  SCORE_REQUEST_TYPE,
  SCORE_RESPONSE_TYPE,
  SITE_POLICY_TYPE,
  THEATER_TYPE,
} from "./constants.js";
import { getVisibleViewportArea, isElementVisible } from "./dom-utils.js";
import { findIframeWindows, findIframes } from "./media-discovery.js";
import { getBestLocalCandidate } from "./media-scoring.js";
import { state } from "./state.js";
import type { FrameTheaterMessage } from "./theater.js";

export type FrameActionRequestMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_HANDLE_ACTION";
  action: MediaAction;
  requestId: string;
  allowPlaceholder?: boolean;
};

export type FrameActionResponseMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_ACTION_RESULT";
  requestId: string;
  handled: boolean;
};

export type FrameScoreRequestMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_SCORE_REQUEST";
  requestId: string;
  budgetMs: number;
};

export type FrameScoreResponseMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_SHORTCUTS_SCORE_RESPONSE";
  requestId: string;
  bestScore: number | null;
  // Visible-area component of bestScore, in the responding frame's viewport.
  areaScore?: number;
};

export type FrameSitePolicyMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_HOTKEYS_SITE_POLICY";
  disabled: boolean;
};

export type FrameMessage =
  | FrameActionRequestMessage
  | FrameActionResponseMessage
  | FrameScoreRequestMessage
  | FrameScoreResponseMessage
  | FrameSitePolicyMessage
  | FrameTheaterMessage;

type ChildFrameBestScore = {
  frameWindow: Window;
  requestId: string;
  score: number;
  areaScore: number;
};

export type ExecuteRoute = "local" | { frameWindow: Window; requestId: string };

type TheaterGrant = {
  frameWindow: Window;
  // The requestId this frame's own parent routed the action under, used to
  // pass the promotion request one level further up.
  parentRequestId?: string;
};

const pendingFrameActionRequests = new Map<string, (handled: boolean) => void>();
const pendingScoreRequests = new Map<
  string,
  (bestScore: number | null, areaScore: number, frameWindow: Window) => void
>();
const executeRoutesByRequestId = new Map<string, ExecuteRoute>();
const theaterGrantsByRequestId = new Map<string, TheaterGrant>();

let topLevelSitePolicyDisabled = false;
let topLevelSitePolicyDisabledForEmbeds = false;

export function isTopWindow(): boolean {
  return window.parent === window;
}

export function isSiteDisabledByPolicy(): boolean {
  return topLevelSitePolicyDisabled;
}

function createSitePolicyMessage(): FrameSitePolicyMessage {
  return {
    source: MESSAGE_SOURCE,
    type: SITE_POLICY_TYPE,
    disabled: topLevelSitePolicyDisabledForEmbeds,
  };
}

export function refreshTopLevelSitePolicy(): void {
  if (!isTopWindow()) {
    return;
  }

  const matchingPolicy = findMatchingSitePolicy(window.location.href, state.settings.siteSettings);
  topLevelSitePolicyDisabled = matchingPolicy?.policy === "disabled";
  topLevelSitePolicyDisabledForEmbeds =
    topLevelSitePolicyDisabled && matchingPolicy?.embedsPolicy !== "ignore";
  broadcastTopLevelSitePolicy();
}

/** Applies a site-policy notification received from the parent frame. */
export function applyParentSitePolicy(disabled: boolean): void {
  topLevelSitePolicyDisabled = disabled;
  topLevelSitePolicyDisabledForEmbeds = disabled;
  broadcastTopLevelSitePolicy();
}

export function broadcastTopLevelSitePolicy(): void {
  const childFrames = getChildFrameWindows();
  if (childFrames.length === 0) {
    return;
  }

  postMessageToFrames(childFrames, createSitePolicyMessage());
}

export function isFrameActionMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") {
    return false;
  }

  const message = data as Partial<FrameMessage>;
  if (message.source !== MESSAGE_SOURCE || typeof message.type !== "string") {
    return false;
  }

  if (message.type === SITE_POLICY_TYPE) {
    return typeof (message as Partial<FrameSitePolicyMessage>).disabled === "boolean";
  }

  if (message.type === THEATER_TYPE) {
    const theaterMessage = message as Partial<FrameTheaterMessage>;
    return (
      typeof theaterMessage.active === "boolean" &&
      (theaterMessage.requestId === undefined || typeof theaterMessage.requestId === "string")
    );
  }

  if (message.type === SCORE_REQUEST_TYPE) {
    const scoreRequest = message as Partial<FrameScoreRequestMessage>;
    return typeof scoreRequest.requestId === "string" && typeof scoreRequest.budgetMs === "number";
  }

  if (message.type === SCORE_RESPONSE_TYPE) {
    const scoreResponse = message as Partial<FrameScoreResponseMessage>;
    return (
      typeof scoreResponse.requestId === "string" &&
      (scoreResponse.bestScore === null || typeof scoreResponse.bestScore === "number") &&
      (scoreResponse.areaScore === undefined || typeof scoreResponse.areaScore === "number")
    );
  }

  return typeof (message as Partial<FrameActionRequestMessage>).requestId === "string";
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createFrameActionRequest(action: MediaAction): FrameActionRequestMessage {
  return {
    source: MESSAGE_SOURCE,
    type: ACTION_REQUEST_TYPE,
    action,
    requestId: createRequestId(),
  };
}

function getChildFrameWindows(): Window[] {
  if (typeof document === "undefined") {
    return [];
  }

  return findIframeWindows(document);
}

function postMessageToFrames(frameWindows: Window[], message: FrameMessage): boolean {
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

export function findIframeForWindow(frameWindow: Window): HTMLIFrameElement | undefined {
  return findIframes(document).find((element) => element.contentWindow === frameWindow);
}

/**
 * Fraction of this frame's viewport covered by the visible part of the iframe
 * hosting `frameWindow`. A child frame measures media area against its own
 * viewport, so a video filling a small (or scrolled-away) iframe would
 * otherwise claim the full visible-area score.
 */
function getFrameViewportShare(frameWindow: Window): number {
  const iframe = findIframeForWindow(frameWindow);
  if (!iframe) {
    return 1;
  }

  const rect = iframe.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea <= 0 || !isElementVisible(iframe, rect)) {
    return 0;
  }

  return Math.min(1, getVisibleViewportArea(rect) / viewportArea);
}

/**
 * Scoring phase (top-frame arbitration, step 1 of 2). Asks every child frame
 * for the best media score in its subtree and returns the winning frame with
 * the requestId that frame can later route an execute request under.
 */
export function collectChildFrameScores(budgetMs: number): Promise<ChildFrameBestScore | null> {
  const childFrames = getChildFrameWindows();
  if (childFrames.length === 0 || budgetMs <= 0) {
    return Promise.resolve(null);
  }

  const requestId = createRequestId();
  const request: FrameScoreRequestMessage = {
    source: MESSAGE_SOURCE,
    type: SCORE_REQUEST_TYPE,
    requestId,
    budgetMs: Math.max(0, budgetMs - SCORE_CHILD_BUDGET_MARGIN_MS),
  };

  return new Promise((resolve) => {
    let best: ChildFrameBestScore | null = null;
    let responseCount = 0;

    const finish = (): void => {
      window.clearTimeout(timeoutId);
      pendingScoreRequests.delete(requestId);
      resolve(best);
    };

    const timeoutId = window.setTimeout(finish, budgetMs);

    pendingScoreRequests.set(requestId, (bestScore, areaScore, frameWindow) => {
      responseCount += 1;
      if (typeof bestScore === "number") {
        const scaledAreaScore = Math.round(areaScore * getFrameViewportShare(frameWindow));
        const score = bestScore - areaScore + scaledAreaScore;
        if (!best || score > best.score) {
          best = { frameWindow, requestId, score, areaScore: scaledAreaScore };
        }
      }

      if (responseCount >= childFrames.length) {
        finish();
      }
    });

    if (!postMessageToFrames(childFrames, request)) {
      finish();
    }
  });
}

/**
 * Scoring phase, child side. Reports the best score across this frame and its
 * own descendants, remembering which frame owned it so a follow-up execute
 * request with the same requestId can be routed straight to the winner.
 */
export async function handleIncomingScoreRequest(
  requestId: string,
  budgetMs: number,
  sourceWindow: Window,
): Promise<void> {
  let bestScore: number | null = null;
  let areaScore = 0;

  if (state.settings.quickSettings.hotkeysEnabled && !isSiteDisabledByPolicy()) {
    const localBest = getBestLocalCandidate();
    let route: ExecuteRoute = "local";
    bestScore = localBest?.score ?? null;
    areaScore = localBest?.areaScore ?? 0;

    if (budgetMs >= SCORE_MIN_CHILD_BUDGET_MS) {
      const childBest = await collectChildFrameScores(budgetMs);
      if (childBest && (bestScore === null || childBest.score > bestScore)) {
        bestScore = childBest.score;
        areaScore = childBest.areaScore;
        route = { frameWindow: childBest.frameWindow, requestId: childBest.requestId };
      }
    }

    if (bestScore !== null) {
      executeRoutesByRequestId.set(requestId, route);
      window.setTimeout(() => executeRoutesByRequestId.delete(requestId), EXECUTE_ROUTE_TTL_MS);
    }
  }

  const response: FrameScoreResponseMessage = {
    source: MESSAGE_SOURCE,
    type: SCORE_RESPONSE_TYPE,
    requestId,
    bestScore,
    areaScore,
  };

  sourceWindow.postMessage(response, "*");
}

/**
 * Execute phase (top-frame arbitration, step 2 of 2). Sends the action to the
 * single frame that won the scoring phase.
 */
export function sendExecuteToFrame(
  frameWindow: Window,
  action: MediaAction,
  requestId: string,
  allowPlaceholder = false,
): Promise<boolean> {
  const request: FrameActionRequestMessage = {
    source: MESSAGE_SOURCE,
    type: ACTION_REQUEST_TYPE,
    action,
    requestId,
    allowPlaceholder,
  };

  return new Promise((resolve) => {
    const timeoutMs = allowPlaceholder ? EXECUTE_PLACEHOLDER_TIMEOUT_MS : EXECUTE_TIMEOUT_MS;
    const settle = (handled: boolean): void => {
      window.clearTimeout(timeoutId);
      pendingFrameActionRequests.delete(requestId);
      resolve(handled);
    };

    const timeoutId = window.setTimeout(() => settle(false), timeoutMs);
    pendingFrameActionRequests.set(requestId, settle);

    try {
      frameWindow.postMessage(request, "*");
    } catch {
      settle(false);
    }
  });
}

/**
 * Last-resort fallback when no frame in the subtree has scorable media: offer
 * placeholder activation to every child frame. Broadcast (rather than routed)
 * because placeholders are not part of the scoring phase; resolves true on the
 * first frame that reports success.
 */
export function broadcastPlaceholderExecute(action: MediaAction): Promise<boolean> {
  const childFrames = getChildFrameWindows();
  if (childFrames.length === 0) {
    return Promise.resolve(false);
  }

  const requestId = createRequestId();
  const request: FrameActionRequestMessage = {
    source: MESSAGE_SOURCE,
    type: ACTION_REQUEST_TYPE,
    action,
    requestId,
    allowPlaceholder: true,
  };

  return new Promise((resolve) => {
    let responseCount = 0;

    const finish = (handled: boolean): void => {
      window.clearTimeout(timeoutId);
      pendingFrameActionRequests.delete(requestId);
      resolve(handled);
    };

    const timeoutId = window.setTimeout(() => finish(false), EXECUTE_PLACEHOLDER_TIMEOUT_MS);

    pendingFrameActionRequests.set(requestId, (handled) => {
      responseCount += 1;
      if (handled || responseCount >= childFrames.length) {
        finish(handled);
      }
    });

    if (!postMessageToFrames(childFrames, request)) {
      finish(false);
    }
  });
}

/**
 * Records that this frame routed toggleTheater to `frameWindow`. Only a child
 * holding a grant may ask this frame to enlarge its iframe; any other frame
 * (an ad, say) could otherwise post the same message to cover the page.
 */
export function grantTheaterPromotion(
  frameWindow: Window,
  requestId: string,
  parentRequestId?: string,
): void {
  theaterGrantsByRequestId.set(requestId, { frameWindow, parentRequestId });
  window.setTimeout(() => theaterGrantsByRequestId.delete(requestId), EXECUTE_ROUTE_TTL_MS);
}

/** Consumes a theater grant if it was issued to `frameWindow`. */
export function takeTheaterGrant(requestId: string, frameWindow: Window): TheaterGrant | undefined {
  const grant = theaterGrantsByRequestId.get(requestId);
  if (!grant || grant.frameWindow !== frameWindow) {
    return undefined;
  }

  theaterGrantsByRequestId.delete(requestId);
  return grant;
}

/** Routes an action-result message back to the awaiting request, if any. */
export function resolveFrameActionResponse(requestId: string, handled: boolean): void {
  pendingFrameActionRequests.get(requestId)?.(handled);
}

/** Routes a score-response message back to the awaiting request, if any. */
export function resolveFrameScoreResponse(
  requestId: string,
  bestScore: number | null,
  areaScore: number,
  frameWindow: Window,
): void {
  pendingScoreRequests.get(requestId)?.(bestScore, areaScore, frameWindow);
}

/** Consumes the execute route recorded for a scoring-phase requestId. */
export function takeExecuteRoute(requestId: string): ExecuteRoute | undefined {
  const route = executeRoutesByRequestId.get(requestId);
  executeRoutesByRequestId.delete(requestId);
  return route;
}

export function respondToFrameAction(
  sourceWindow: Window,
  requestId: string,
  handled: boolean,
): void {
  const response: FrameActionResponseMessage = {
    source: MESSAGE_SOURCE,
    type: ACTION_RESPONSE_TYPE,
    requestId,
    handled,
  };

  sourceWindow.postMessage(response, "*");
}
