import type { MediaAction } from "../storage.js";
import {
  handleAction,
  handleLocalTargetMediaAction,
  isGlobalAction,
  toggleOverlayVisibility,
} from "./actions.js";
import {
  ACTION_REQUEST_TYPE,
  ACTION_RESPONSE_TYPE,
  SCORE_BUDGET_MS,
  SCORE_REQUEST_TYPE,
  SCORE_RESPONSE_TYPE,
  SITE_POLICY_TYPE,
  THEATER_TYPE,
} from "./constants.js";
import { getDeepActiveElement } from "./dom-utils.js";
import {
  applyParentSitePolicy,
  broadcastPlaceholderExecute,
  collectChildFrameScores,
  delegateActionToChildFrames,
  findIframeForWindow,
  grantTheaterPromotion,
  handleIncomingScoreRequest,
  isFrameActionMessage,
  isSiteDisabledByPolicy,
  isTopWindow,
  resolveFrameActionResponse,
  resolveFrameScoreResponse,
  respondToFrameAction,
  sendExecuteToFrame,
  takeExecuteRoute,
  takeTheaterGrant,
} from "./frame-messaging.js";
import {
  STRONG_LOCAL_TARGET_SCORE,
  getBestLocalCandidate,
  getTargetMedia,
} from "./media-scoring.js";
import { activatePlayablePlaceholder } from "./placeholder.js";
import { state } from "./state.js";
import {
  enterFrameTheater,
  exitTheater,
  isTheaterActive,
  isTheaterChildFrame,
  requestParentTheater,
} from "./theater.js";

/**
 * Entry point for a media action initiated in this frame. Arbitrates across
 * this frame and its descendant frames: local candidates and child-frame
 * candidates are scored with the same weighted model, and the action is
 * executed by exactly one frame — the one owning the highest-scoring media.
 * Local candidates win ties. Placeholder activation is the final fallback
 * when no frame in the subtree has scorable media.
 */
export async function dispatchMediaAction(action: MediaAction): Promise<boolean> {
  const localBest = getBestLocalCandidate();

  // Unambiguous local intent (focus/fullscreen/PiP): act immediately without
  // paying the cross-frame scoring round-trip.
  if (localBest && localBest.score >= STRONG_LOCAL_TARGET_SCORE) {
    handleLocalDispatchedAction(action, localBest.media);
    return true;
  }

  const childBest = await collectChildFrameScores(SCORE_BUDGET_MS);
  if (childBest && (!localBest || childBest.score > localBest.score)) {
    if (action === "toggleTheater") {
      grantTheaterPromotion(childBest.frameWindow, childBest.requestId);
    }
    const handled = await sendExecuteToFrame(childBest.frameWindow, action, childBest.requestId);
    if (handled) {
      return true;
    }
  }

  if (localBest) {
    handleLocalDispatchedAction(action, localBest.media);
    return true;
  }

  if (await activatePlayablePlaceholder(action)) {
    return true;
  }

  return broadcastPlaceholderExecute(action);
}

/**
 * Runs an action this frame initiated on its own media. In an embedded frame,
 * entering theater mode then asks the parent to enlarge the iframe, which it
 * allows because the keypress left focus inside this frame.
 */
function handleLocalDispatchedAction(action: MediaAction, media: HTMLMediaElement): void {
  handleAction(action, media);
  if (action === "toggleTheater" && !isTopWindow() && isTheaterActive()) {
    requestParentTheater();
  }
}

export async function handleGlobalAction(action: "toggleOverlays"): Promise<boolean> {
  const media = getTargetMedia();
  if (media) {
    handleAction(action, media);
  } else {
    toggleOverlayVisibility();
  }

  const handledByChildFrame = await delegateActionToChildFrames(action);
  return Boolean(media) || handledByChildFrame;
}

/**
 * Execute phase, receiving side. Global actions keep their broadcast cascade.
 * Media actions follow the route recorded during the scoring phase; if the
 * routed descendant fails (or no route exists), fall back to the best local
 * candidate, then to placeholder activation when permitted.
 */
async function handleIncomingFrameAction(
  action: MediaAction,
  requestId: string,
  allowPlaceholder: boolean,
): Promise<boolean> {
  if (!state.settings.quickSettings.hotkeysEnabled || isSiteDisabledByPolicy()) {
    return false;
  }

  if (isGlobalAction(action)) {
    return handleGlobalAction(action);
  }

  const route = takeExecuteRoute(requestId);
  if (route && route !== "local") {
    if (action === "toggleTheater") {
      grantTheaterPromotion(route.frameWindow, route.requestId, requestId);
    }
    const handled = await sendExecuteToFrame(
      route.frameWindow,
      action,
      route.requestId,
      allowPlaceholder,
    );
    if (handled) {
      return true;
    }
  }

  if (handleLocalTargetMediaAction(action)) {
    if (action === "toggleTheater" && isTheaterActive()) {
      requestParentTheater(requestId);
    }
    return true;
  }

  if (allowPlaceholder) {
    if (await activatePlayablePlaceholder(action)) {
      return true;
    }

    return broadcastPlaceholderExecute(action);
  }

  return false;
}

/**
 * From the parent, a theater message is always an exit order. From a child it
 * reports that child's state: exits shrink the iframe if it is the promoted
 * one, and entries enlarge it only against a grant this frame issued when it
 * routed toggleTheater there, or when that iframe holds focus here. The
 * request is then passed up the same way.
 */
function handleTheaterMessage(
  active: boolean,
  requestId: string | undefined,
  source: Window,
): void {
  if (!isTopWindow() && source === window.parent) {
    if (!active) {
      exitTheater();
    }
    return;
  }

  if (!active) {
    if (isTheaterChildFrame(source)) {
      exitTheater();
    }
    return;
  }

  const grant = requestId ? takeTheaterGrant(requestId, source) : undefined;
  const iframe = findIframeForWindow(source);
  // Focus inside the iframe is the user's own pointer at it (they clicked into
  // the embed), which the parent never saw as a routed keypress.
  const isTrusted = Boolean(grant) || (iframe !== undefined && getDeepActiveElement() === iframe);
  if (!isTrusted || !iframe || !enterFrameTheater(iframe)) {
    return;
  }

  if (!isTopWindow()) {
    requestParentTheater(grant?.parentRequestId);
  }
}

export function handleFrameMessage(event: MessageEvent): void {
  if (event.source !== window && !event.source) {
    return;
  }

  if (!isFrameActionMessage(event.data)) {
    return;
  }

  if (event.data.type === SITE_POLICY_TYPE) {
    if (isTopWindow() || event.source !== window.parent) {
      return;
    }

    applyParentSitePolicy(event.data.disabled);
    return;
  }

  if (event.data.type === THEATER_TYPE) {
    if (event.source && event.source !== window) {
      handleTheaterMessage(event.data.active, event.data.requestId, event.source as Window);
    }
    return;
  }

  if (event.data.type === ACTION_RESPONSE_TYPE) {
    resolveFrameActionResponse(event.data.requestId, event.data.handled);
    return;
  }

  if (event.data.type === SCORE_RESPONSE_TYPE) {
    if (event.source) {
      resolveFrameScoreResponse(
        event.data.requestId,
        event.data.bestScore,
        event.data.areaScore ?? 0,
        event.source as Window,
      );
    }
    return;
  }

  if (event.data.type === SCORE_REQUEST_TYPE) {
    if (event.source) {
      void handleIncomingScoreRequest(
        event.data.requestId,
        event.data.budgetMs,
        event.source as Window,
      );
    }
    return;
  }

  if (!event.source || event.data.type !== ACTION_REQUEST_TYPE) {
    return;
  }

  const actionRequest = event.data;
  void handleIncomingFrameAction(
    actionRequest.action,
    actionRequest.requestId,
    actionRequest.allowPlaceholder === true,
  ).then((handled) => {
    respondToFrameAction(event.source as Window, actionRequest.requestId, handled);
  });
}
