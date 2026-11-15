import {
  type AdvancedSettings,
  type MediaAction,
  resolveActionOverlaySettings,
} from "../storage.js";
import { showActionOverlay } from "../overlay.js";
import { type CaptionsToggle, hasCaptionTracks, toggleCaptions } from "./captions.js";
import { debugLog, isPictureInPictureSupported } from "./dom-utils.js";
import { getFullscreenHost, unwrapManagedFullscreenMedia } from "./fullscreen.js";
import { getTargetMedia } from "./media-scoring.js";
import { trackInteraction } from "./media-tracking.js";
import {
  getEffectiveVolume,
  pauseMedia,
  playMedia,
  readPlayerCurrentTime,
  readMediaTimeline,
  readPlayerMuted,
  readPlayerPaused,
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

/**
 * Seconds the playhead is behind the live edge, for media that is live and can
 * rewind, and `null` for everything else.
 */
function readBehindLiveSeconds(media: HTMLMediaElement): number | null {
  const { kind, range } = readMediaTimeline(media);
  if (kind !== "live" || !range) {
    return null;
  }

  return Math.max(0, range.end - readPlayerCurrentTime(media));
}

/**
 * Moves the playhead by `seconds`. A live stream with nothing to rewind through
 * can't seek, and a rewindable one is held to its window, because a host player
 * may not clamp the way a media element does. Returns whether it seeked.
 */
function seekBy(media: HTMLMediaElement, seconds: number): boolean {
  const { kind, range } = readMediaTimeline(media);
  if (kind === "live" && !range) {
    return false;
  }

  const currentTime = readPlayerCurrentTime(media);
  const target = currentTime + seconds;
  if (kind !== "live" || !range) {
    setPlayerCurrentTime(media, target);
    return true;
  }

  // Already at the edge being skipped toward: nothing moves.
  const clampedTarget = Math.min(range.end, Math.max(range.start, target));
  if (clampedTarget === currentTime) {
    return false;
  }

  setPlayerCurrentTime(media, clampedTarget);
  return true;
}

/**
 * Seeks to a fraction of the media's length. A live stream has no length a
 * percentage means anything for (it may have been running for days), so only a
 * `vod` takes it.
 */
function seekToFraction(media: HTMLMediaElement, fraction: number): boolean {
  const { kind, range } = readMediaTimeline(media);
  if (kind !== "vod") {
    return false;
  }

  setPlayerCurrentTime(media, range.start + (range.end - range.start) * fraction);
  return true;
}

function restartMedia(media: HTMLMediaElement): boolean {
  const { kind, range } = readMediaTimeline(media);
  if (range) {
    setPlayerCurrentTime(media, range.start);
    return true;
  }

  // Before metadata the player may still take a start position. A live stream
  // with nothing to rewind through has no start to go back to.
  if (kind === "unknown") {
    setPlayerCurrentTime(media, 0);
    return true;
  }

  return false;
}

function isSeekToPercent(action: MediaAction): boolean {
  return /^seekToPercent\d+$/.test(action);
}

export function isGlobalAction(action: MediaAction): action is "toggleOverlays" {
  return action === "toggleOverlays";
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

  const currentTime = readPlayerCurrentTime(media);
  const { range } = readMediaTimeline(media);
  const projectedTime = direction === "forward" ? currentTime + step : currentTime - step;
  // Media with no range still can't go before zero, and has no end to pass.
  const wouldExceedBounds =
    projectedTime < (range?.start ?? 0) || projectedTime > (range?.end ?? Infinity);
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
  previousTime: number | null,
  overlaysEnabled: boolean,
): {
  seekSeconds?: number;
  animateSkipDirection?: SeekDirection;
  timestampSeconds?: number;
  jumpDirection?: SeekDirection;
  behindLiveSeconds?: number;
  overlayEnabled?: boolean;
} {
  if (action === "toggleOverlays") {
    clearSeekOverlayState();
    return {
      overlayEnabled: overlaysEnabled,
    };
  }

  if (action === "restart") {
    clearSeekOverlayState();
    const behindLiveSeconds = readBehindLiveSeconds(media);
    return {
      timestampSeconds: 0,
      jumpDirection: "backward",
      ...(behindLiveSeconds !== null && { behindLiveSeconds }),
    };
  }

  const percentMatch = action.match(/^seekToPercent(\d+)$/);
  if (percentMatch) {
    clearSeekOverlayState();
    const currentTime = readPlayerCurrentTime(media);
    return {
      timestampSeconds: currentTime,
      jumpDirection:
        typeof previousTime === "number" && currentTime < previousTime ? "backward" : "forward",
    };
  }

  return getSeekOverlayDisplay(action, media);
}

/**
 * `overlaysEnabled` is the value the overlay toggle's confirmation reports. A
 * frame executing the toggle for another frame gets it with the request,
 * because its own settings still hold the old value until storage notifies it.
 */
export function handleAction(
  action: MediaAction,
  media: HTMLMediaElement,
  overlaysEnabled = state.settings.advancedSettings.showOverlays,
): boolean {
  const advancedSettings = state.settings.advancedSettings;
  // The key reaches this media only when it was thought to have captions, but
  // arbitration can pick another one. Leave an unrelated media's standing alone.
  if (action === "toggleCaptions" && !hasCaptionTracks(media)) {
    debugLog("No caption tracks to toggle", media, { action });
    return false;
  }

  // Only the percent seeks compare against it, so other actions skip the read.
  const previousTime = isSeekToPercent(action) ? readPlayerCurrentTime(media) : null;
  let captions: CaptionsToggle | null = null;
  // False when the media had nothing to act on, such as a skip in a live stream
  // that can't rewind, so the overlay doesn't report a move that never happened.
  let performed = true;

  switch (action) {
    case "togglePlayPause":
      readPlayerPaused(media) ? playMedia(media) : pauseMedia(media);
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
      // The frame that got the key already flipped and saved the setting
      // (handleGlobalAction); this frame only shows the confirmation.
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

    case "toggleCaptions":
      captions = toggleCaptions(media);
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
      performed = seekBy(media, advancedSettings.seekStepSmall);
      break;

    case "seekBackwardSmall":
      performed = seekBy(media, -advancedSettings.seekStepSmall);
      break;

    case "seekForwardMedium":
      performed = seekBy(media, advancedSettings.seekStepMedium);
      break;

    case "seekBackwardMedium":
      performed = seekBy(media, -advancedSettings.seekStepMedium);
      break;

    case "seekForwardLarge":
      performed = seekBy(media, advancedSettings.seekStepLarge);
      break;

    case "seekBackwardLarge":
      performed = seekBy(media, -advancedSettings.seekStepLarge);
      break;

    case "restart":
      performed = restartMedia(media);
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
      if (percentMatch) {
        performed = seekToFraction(media, parseInt(percentMatch[1], 10) / 100);
      }
    }
  }

  if (!performed) {
    clearSeekOverlayState();
    debugLog("Nothing to act on for action", media, { action });
    return false;
  }

  // An action that did nothing must not change which media later keys target.
  actionedMedia.add(media);
  state.lastActionedMedia = media;
  trackInteraction(media, `action:${action}`);

  const overlaySettings = resolveActionOverlaySettings(action, advancedSettings);
  if (overlaySettings.overlayVisible) {
    showActionOverlay(action, media, overlaySettings.overlayPosition, advancedSettings, {
      ...getOverlayDisplayOptions(action, media, previousTime, overlaysEnabled),
      ...(captions && { captions }),
    });
  } else if (getSeekDirection(action)) {
    getSeekOverlayDisplay(action, media);
  } else {
    clearSeekOverlayState();
  }

  debugLog("Handled media action", media, { action });
  return true;
}

export function handleLocalTargetMediaAction(
  action: MediaAction,
  overlaysEnabled?: boolean,
): boolean {
  const media = getTargetMedia();
  // Reporting "not handled" lets the frame that routed the action here fall
  // back to media of its own that does have a track.
  if (media && action === "toggleCaptions" && !hasCaptionTracks(media)) {
    return false;
  }

  if (media) {
    // An action the media couldn't act on counts as not handled, so the frame
    // that routed it here can fall back to its own media.
    return handleAction(action, media, overlaysEnabled);
  }

  return false;
}
