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
} from "./constants.js";
import {
  applyParentSitePolicy,
  broadcastPlaceholderExecute,
  collectChildFrameScores,
  delegateActionToChildFrames,
  handleIncomingScoreRequest,
  isFrameActionMessage,
  isSiteDisabledByPolicy,
  isTopWindow,
  resolveFrameActionResponse,
  resolveFrameScoreResponse,
  respondToFrameAction,
  sendExecuteToFrame,
  takeExecuteRoute,
} from "./frame-messaging.js";
import {
  STRONG_LOCAL_TARGET_SCORE,
  getBestLocalCandidate,
  getTargetMedia,
} from "./media-scoring.js";
import { activatePlayablePlaceholder } from "./placeholder.js";
import { state } from "./state.js";

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
    handleAction(action, localBest.media);
    return true;
  }

  const childBest = await collectChildFrameScores(SCORE_BUDGET_MS);
  if (childBest && (!localBest || childBest.score > localBest.score)) {
    const handled = await sendExecuteToFrame(childBest.frameWindow, action, childBest.requestId);
    if (handled) {
      return true;
    }
  }

  if (localBest) {
    handleAction(action, localBest.media);
    return true;
  }

  if (await activatePlayablePlaceholder(action)) {
    return true;
  }

  return broadcastPlaceholderExecute(action);
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

  if (event.data.type === ACTION_RESPONSE_TYPE) {
    resolveFrameActionResponse(event.data.requestId, event.data.handled);
    return;
  }

  if (event.data.type === SCORE_RESPONSE_TYPE) {
    if (event.source) {
      resolveFrameScoreResponse(event.data.requestId, event.data.bestScore, event.source as Window);
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
