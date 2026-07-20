import { debugLog } from "./dom-utils.js";

type PlayerBridgeCommandName =
  | "play"
  | "pause"
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

function tryDirectHostMethodSync(host: HTMLElement, methodName: string): boolean {
  const method = getHostMember(host, methodName);
  if (typeof method !== "function") {
    return false;
  }

  try {
    void method.call(host);
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

function readDirectHostNumber(host: HTMLElement, propertyName: string): number | null {
  if (!(propertyName in host)) {
    return null;
  }

  const value = getHostMember(host, propertyName);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  return tryDirectHostMethodSync(host, methodName) || tryBridgeMethod(host, command);
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
        } catch {
          // Fall back to the bridge, play-button click, then native media playback.
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

export function readPlayerDuration(media: HTMLMediaElement): number {
  return readCustomPlayerNumber(media, "duration", "readDuration") ?? media.duration;
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
    tryBridgeMethod(host, "requestFullscreen") || tryDirectHostMethodSync(host, "requestFullscreen")
  );
}
