import { debugLog } from "./dom-utils.js";

type PlayerBridgeCommandName =
  | "play"
  | "pause"
  | "readPaused"
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
  // JSON turns NaN and Infinity into null, so the bridge names them instead.
  nonFinite?: unknown;
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

// Host methods such as play() and requestFullscreen() may return a promise that
// rejects when the browser or the player refuses (no user activation, an iframe
// without allowfullscreen). The action is best-effort, so settle the promise
// here instead of leaving an unhandled rejection in the page console. Any
// thenable counts: the host may be a page object from another realm.
function handleHostMethodRejection(
  result: unknown,
  media: HTMLMediaElement,
  methodName: string,
): void {
  if (!result || (typeof result !== "object" && typeof result !== "function")) {
    return;
  }

  try {
    void Promise.resolve(result).catch((error: unknown) => {
      debugLog(`Host ${methodName}() was rejected`, media, { error });
    });
  } catch {
    // A hostile thenable can throw while it is read. The method already ran.
  }
}

function tryDirectHostMethodSync(
  host: HTMLElement,
  methodName: string,
  media: HTMLMediaElement,
): boolean {
  const method = getHostMember(host, methodName);
  if (typeof method !== "function") {
    return false;
  }

  try {
    handleHostMethodRejection(method.call(host), media, methodName);
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

function readDirectHostNumber(
  host: HTMLElement,
  propertyName: string,
  allowNonFinite = false,
): number | null {
  if (!(propertyName in host)) {
    return null;
  }

  const value = getHostMember(host, propertyName);
  return typeof value === "number" && (allowNonFinite || Number.isFinite(value)) ? value : null;
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

function parseNonFiniteNumber(name: unknown): number | null {
  switch (name) {
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    default:
      return null;
  }
}

// Unlike the other numbers, a duration may legitimately be non-finite: Infinity
// for a stream with no end and NaN for one that isn't known yet.
function readBridgeDuration(host: HTMLElement): number | null {
  const response = requestPlayerBridge(host, "readDuration");
  if (response?.handled !== true) {
    return null;
  }

  if (typeof response.value === "number" && Number.isFinite(response.value)) {
    return response.value;
  }

  return parseNonFiniteNumber(response.nonFinite);
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

  return tryDirectHostMethodSync(host, methodName, media) || tryBridgeMethod(host, command);
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
        } catch (error) {
          // Fall back to the bridge, play-button click, then native media playback.
          debugLog("Host play() was rejected", media, { error });
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

export function playMedia(media: HTMLMediaElement): void {
  void tryPlayMedia(media);
}

export function pauseMedia(media: HTMLMediaElement): void {
  if (tryCustomPlayerMethodSync(media, "pause", "pause")) {
    return;
  }

  media.pause();
}

export function readPlayerPaused(media: HTMLMediaElement): boolean {
  return readCustomPlayerBoolean(media, "paused", "readPaused") ?? media.paused;
}

/**
 * Whether the media is playing, as the player reports it. A custom-element
 * host that reports `paused` decides on its own: its inner element may never
 * load, or lag behind the host, so `ended` and `readyState` say nothing about
 * it. Everything else is judged from the element: not paused or ended, and
 * with at least metadata. Stalled playback (buffering) drops `readyState` to
 * HAVE_CURRENT_DATA or HAVE_METADATA while the media is still logically
 * playing, and users often press keys exactly then.
 */
export function readPlayerPlaying(media: HTMLMediaElement): boolean {
  const hostPaused = readCustomPlayerBoolean(media, "paused", "readPaused");
  if (hostPaused !== null) {
    return !hostPaused;
  }

  return !media.paused && !media.ended && media.readyState >= 1;
}

export function getEffectiveVolume(media: HTMLMediaElement): number {
  return readPlayerMuted(media) ? 0 : readPlayerVolume(media);
}

export function readPlayerMuted(media: HTMLMediaElement): boolean {
  return readCustomPlayerBoolean(media, "muted", "readMuted") ?? media.muted;
}

export function setPlayerMuted(media: HTMLMediaElement, muted: boolean): void {
  if (setCustomPlayerProperty(media, "muted", "setMuted", muted)) {
    return;
  }

  media.muted = muted;
}

export function readPlayerVolume(media: HTMLMediaElement): number {
  const volume = readCustomPlayerNumber(media, "volume", "readVolume");
  return typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : media.volume;
}

export function setPlayerVolume(media: HTMLMediaElement, volume: number): void {
  const clampedVolume = Math.min(1, Math.max(0, volume));
  if (setCustomPlayerProperty(media, "volume", "setVolume", clampedVolume)) {
    return;
  }

  media.volume = clampedVolume;
}

export function readPlayerCurrentTime(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "currentTime", "readCurrentTime") ?? media.currentTime;
}

export function setPlayerCurrentTime(media: HTMLMediaElement, currentTime: number): void {
  if (setCustomPlayerProperty(media, "currentTime", "setCurrentTime", currentTime)) {
    return;
  }

  media.currentTime = currentTime;
}

/**
 * The player's duration: a custom-element host's own when it reports a number,
 * even one that isn't finite (Infinity for a live stream, NaN while unknown),
 * and the media element's otherwise.
 */
export function readPlayerDuration(media: HTMLMediaElement): number {
  const host = getCustomMediaHost(media);
  const hostDuration = host
    ? (readDirectHostNumber(host, "duration", true) ?? readBridgeDuration(host))
    : null;
  return hostDuration ?? media.duration;
}

/** The span of media time a seek can land in, in the player's own time. */
export type SeekRange = { start: number; end: number };

/**
 * What kind of media this is, judged from its duration:
 * - `vod`: a finite, positive duration. Its range is the whole media.
 * - `live`: an infinite duration, a stream with no end. It has a range only when
 *   the media's `seekable` holds a finite window to rewind through (DVR), and
 *   the end of that window is the live edge.
 * - `unknown`: anything else, mostly NaN before metadata has loaded.
 */
export type MediaTimeline =
  | { kind: "vod"; range: SeekRange }
  | { kind: "live"; range: SeekRange | null }
  | { kind: "unknown"; range: null };

// `seekable` is read from the media element even inside a custom player: a host
// has no counterpart for it, and the element holds the real buffered window.
// Only the last range counts: it ends at the live edge, and the span between
// separate ranges isn't seekable, so one window can't cover them.
function readSeekableWindow(media: HTMLMediaElement): SeekRange | null {
  try {
    const ranges = media.seekable as TimeRanges | undefined;
    if (!ranges || ranges.length === 0) {
      return null;
    }

    const start = ranges.start(ranges.length - 1);
    const end = ranges.end(ranges.length - 1);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
  } catch {
    return null;
  }
}

/** Whether the media is a live stream with a rewindable window to skip to the end of. */
export function canSeekToLive(media: HTMLMediaElement | null): boolean {
  if (!media) {
    return false;
  }

  const { kind, range } = readMediaTimeline(media);
  return kind === "live" && range !== null;
}

export function readMediaTimeline(media: HTMLMediaElement): MediaTimeline {
  const duration = readPlayerDuration(media);
  if (Number.isFinite(duration) && duration > 0) {
    return { kind: "vod", range: { start: 0, end: duration } };
  }

  if (duration === Infinity) {
    return { kind: "live", range: readSeekableWindow(media) };
  }

  return { kind: "unknown", range: null };
}

export function readPlayerPlaybackRate(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "playbackRate", "readPlaybackRate") ?? media.playbackRate;
}

export function setPlayerPlaybackRate(media: HTMLMediaElement, playbackRate: number): void {
  if (setCustomPlayerProperty(media, "playbackRate", "setPlaybackRate", playbackRate)) {
    return;
  }

  media.playbackRate = playbackRate;
}

export function requestCustomPlayerFullscreen(media: HTMLMediaElement): boolean {
  const host = getCustomMediaHost(media);
  if (!host) {
    return false;
  }

  return (
    tryBridgeMethod(host, "requestFullscreen") ||
    tryDirectHostMethodSync(host, "requestFullscreen", media)
  );
}
