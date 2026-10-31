import {
  type AdvancedSettings,
  type ConfigurableMediaAction,
  type MediaAction,
  resolveActionOverlaySettings,
  saveSettings,
} from "../storage.js";
import { showActionOverlay } from "../overlay.js";
import { debugLog, isPictureInPictureSupported } from "./dom-utils.js";
import { getFullscreenHost, unwrapManagedFullscreenMedia } from "./fullscreen.js";
import { getTargetMedia } from "./media-scoring.js";
import { trackInteraction } from "./media-tracking.js";
import {
  getEffectiveVolume,
  pauseMedia,
  playMedia,
  readPlayerCurrentTime,
  readPlayerDuration,
  readPlayerMuted,
  readPlayerPlaybackRate,
  readPlayerVolume,
  requestCustomPlayerFullscreen,
  setPlayerCurrentTime,
  setPlayerMuted,
  setPlayerPlaybackRate,
  setPlayerVolume,
} from "./player-control.js";
import { actionedMedia, state } from "./state.js";
import { exitTheater, toggleTheater } from "./theater.js";

export type SeekDirection = "forward" | "backward";

type SeekOverlayState = {
  direction: SeekDirection;
  media: HTMLMediaElement;
  totalSeconds: number;
  resetTimeout: ReturnType<typeof setTimeout> | null;
};

let seekOverlayState: SeekOverlayState | null = null;

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

// Steps such as 0.05 accumulate floating-point error (1.1500000000000001).
function roundPlaybackRate(playbackRate: number): number {
  return Math.round(playbackRate * 100) / 100;
}

export function isGlobalAction(action: MediaAction): action is "toggleOverlays" {
  return action === "toggleOverlays";
}

function isConfigurableMediaAction(action: MediaAction): action is ConfigurableMediaAction {
  return action in state.settings.quickSettings.actionKeyBindings;
}

export function toggleOverlayVisibility(): void {
  state.settings.advancedSettings.showOverlays = !state.settings.advancedSettings.showOverlays;
  void saveSettings({
    advancedSettings: {
      showOverlays: state.settings.advancedSettings.showOverlays,
    },
  });
}

function getSeekOverlayDisplay(
  action: MediaAction,
  media: HTMLMediaElement,
): {
  seekSeconds?: number;
  animateSkipDirection?: SeekDirection;
} {
  const advancedSettings = state.settings.advancedSettings;
  const step = getSeekStep(action, advancedSettings);
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
  const totalSeconds = advancedSettings.sumQuickSkips
    ? (shouldResetStreak ? 0 : (seekOverlayState?.totalSeconds ?? 0)) + step
    : step;
  const resetTimeout = setTimeout(() => {
    if (seekOverlayState?.media === media && seekOverlayState.direction === direction) {
      seekOverlayState = null;
    }
  }, advancedSettings.overlayVisibleDuration + advancedSettings.overlayFadeDuration);

  seekOverlayState = {
    direction,
    media,
    totalSeconds,
    resetTimeout,
  };

  const animateSkipDirection =
    advancedSettings.skipOverlayPosition === "left / right" &&
    (!advancedSettings.sumQuickSkips || !isContinuingStreak)
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
      overlayEnabled: state.settings.advancedSettings.showOverlays,
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
  const advancedSettings = state.settings.advancedSettings;
  const previousTime = media.currentTime;
  actionedMedia.add(media);
  state.lastActionedMedia = media;
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
        // Browsers reject without user activation or in iframes lacking
        // allowfullscreen; that's expected, so keep it out of the page console.
        if (document.fullscreenElement) {
          document.exitFullscreen().catch((error: unknown) => {
            debugLog("Fullscreen exit was rejected", media, { error });
          });
        } else {
          // The fullscreen wrapper reparents the video, which would drop it out
          // of the top layer anyway; leave theater mode cleanly first.
          exitTheater();
          if (requestCustomPlayerFullscreen(media)) {
            break;
          }

          const fullscreenHost = getFullscreenHost(media);
          if (!fullscreenHost) {
            media.requestFullscreen().catch((error: unknown) => {
              debugLog("Fullscreen request was rejected", media, { error });
            });
            break;
          }

          void fullscreenHost.requestFullscreen().catch((error: unknown) => {
            debugLog("Fullscreen request was rejected", media, { error });
            if (document.fullscreenElement !== fullscreenHost) {
              unwrapManagedFullscreenMedia();
            }
          });
        }
      }
      break;

    case "togglePip":
      if (media instanceof HTMLVideoElement && isPictureInPictureSupported()) {
        // Rejected when the video has no data yet or disables PiP itself.
        if (document.pictureInPictureElement) {
          void document.exitPictureInPicture().catch(() => undefined);
        } else {
          void media.requestPictureInPicture().catch(() => undefined);
        }
      }
      break;

    case "toggleTheater":
      if (media instanceof HTMLVideoElement) {
        toggleTheater(media);
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
          roundPlaybackRate(readPlayerPlaybackRate(media) + advancedSettings.speedStep),
        ),
      );
      break;

    case "slowDown":
      setPlayerPlaybackRate(
        media,
        Math.max(
          advancedSettings.speedMin,
          roundPlaybackRate(readPlayerPlaybackRate(media) - advancedSettings.speedStep),
        ),
      );
      break;

    default: {
      const percentMatch = action.match(/^seekToPercent(\d+)$/);
      const duration = readPlayerDuration(media);
      // Live streams report an infinite duration and have no percentages.
      if (percentMatch && Number.isFinite(duration) && duration > 0) {
        const percent = parseInt(percentMatch[1], 10) / 100;
        setPlayerCurrentTime(media, duration * percent);
      }
    }
  }

  const actionConfig = isConfigurableMediaAction(action)
    ? state.settings.quickSettings.actionKeyBindings[action]
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

export function handleLocalTargetMediaAction(action: MediaAction): boolean {
  const media = getTargetMedia();
  if (media) {
    handleAction(action, media);
    return true;
  }

  return false;
}
