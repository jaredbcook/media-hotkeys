import type { MediaAction } from "../storage.js";
import { handleAction, handleLocalTargetMediaAction } from "./actions.js";
import {
  ACTION_REQUEST_TYPE,
  ACTION_RESPONSE_TYPE,
  MEDIA_PRESENCE_REQUEST_TYPE,
  MEDIA_PRESENCE_TYPE,
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
  findIframeForWindow,
  grantTheaterPromotion,
  handleIncomingScoreRequest,
  isFrameActionMessage,
  isFromChildFrame,
  isFromParentFrame,
  isSiteDisabledByPolicy,
  isTopWindow,
  resolveFrameActionResponse,
  resolveFrameScoreResponse,
  respondToFrameAction,
  sendExecuteToFrame,
  takeExecuteRoute,
  takeTheaterGrant,
} from "./frame-messaging.js";
import { STRONG_LOCAL_TARGET_SCORE, getBestLocalCandidate } from "./media-scoring.js";
import { handleMediaPresenceMessage } from "./media-presence.js";
import { activatePlayablePlaceholder } from "./placeholder.js";
import { toggleOverlayVisibility } from "./settings-sync.js";
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

// Counts overlay toggles started in this frame, so a confirmation still in
// arbitration can tell that a newer keypress has replaced it.
let overlayToggleCount = 0;

/**
 * The overlay toggle, in the frame that received the keypress. This frame
 * alone flips and saves the setting. The confirmation overlay then goes to
 * one frame through the same score/execute arbitration as a media action,
 * carrying the new value, since that frame may not have reloaded settings yet.
 */
export async function handleGlobalAction(action: "toggleOverlays"): Promise<boolean> {
  const overlaysEnabled = toggleOverlayVisibility();
  overlayToggleCount += 1;
  const toggleNumber = overlayToggleCount;
  // After a newer toggle, showing this one's value would report a stale state.
  const isSuperseded = (): boolean => toggleNumber !== overlayToggleCount;

  const localBest = getBestLocalCandidate();
  if (localBest && localBest.score >= STRONG_LOCAL_TARGET_SCORE) {
    handleAction(action, localBest.media, overlaysEnabled);
    return true;
  }

  const childBest = await collectChildFrameScores(SCORE_BUDGET_MS);
  if (isSuperseded()) {
    return true;
  }

  if (childBest && (!localBest || childBest.score > localBest.score)) {
    const handled = await sendExecuteToFrame(
      childBest.frameWindow,
      action,
      childBest.requestId,
      false,
      overlaysEnabled,
    );
    if (handled || isSuperseded()) {
      return true;
    }
  }

  if (localBest) {
    handleAction(action, localBest.media, overlaysEnabled);
    return true;
  }

  return false;
}

/**
 * Execute phase, receiving side. Actions follow the route recorded during the
 * scoring phase; if the routed descendant fails (or no route exists), fall
 * back to the best local candidate, then to placeholder activation when
 * permitted. For the overlay toggle this only shows the confirmation with the
 * value the request carries: a request never changes or saves the setting.
 */
async function handleIncomingFrameAction(
  action: MediaAction,
  requestId: string,
  allowPlaceholder: boolean,
  overlaysEnabled?: boolean,
): Promise<boolean> {
  if (!state.settings.quickSettings.hotkeysEnabled || isSiteDisabledByPolicy()) {
    return false;
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
      overlaysEnabled,
    );
    if (handled) {
      return true;
    }
  }

  if (handleLocalTargetMediaAction(action, overlaysEnabled)) {
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
  if (!event.source || !isFrameActionMessage(event.data)) {
    return;
  }

  const { data, source } = event;
  switch (data.type) {
    case SITE_POLICY_TYPE:
      if (isFromParentFrame(source)) {
        applyParentSitePolicy(data.disabled);
      }
      return;

    case MEDIA_PRESENCE_TYPE:
    case MEDIA_PRESENCE_REQUEST_TYPE:
      if (source !== window) {
        handleMediaPresenceMessage(data, source as Window);
      }
      return;

    case THEATER_TYPE:
      if (source !== window) {
        handleTheaterMessage(data.active, data.requestId, source as Window);
      }
      return;

    case ACTION_RESPONSE_TYPE:
      if (isFromChildFrame(source)) {
        resolveFrameActionResponse(data.requestId, data.handled);
      }
      return;

    case SCORE_RESPONSE_TYPE:
      if (isFromChildFrame(source)) {
        resolveFrameScoreResponse(data.requestId, data.bestScore, data.areaScore ?? 0, source);
      }
      return;

    case SCORE_REQUEST_TYPE:
      if (isFromParentFrame(source)) {
        void handleIncomingScoreRequest(data.requestId, data.budgetMs, source as Window);
      }
      return;

    case ACTION_REQUEST_TYPE:
      if (isFromParentFrame(source)) {
        void handleIncomingFrameAction(
          data.action,
          data.requestId,
          data.allowPlaceholder === true,
          data.overlaysEnabled,
        ).then((handled) => {
          respondToFrameAction(source as Window, data.requestId, handled);
        });
      }
      return;
  }
}
