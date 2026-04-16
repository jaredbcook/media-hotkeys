// Runs in the page's main world so page-defined custom element player APIs are visible.
// Keep this file import-free: it cannot rely on extension APIs from the main world.

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

type PlayerBridgeCommand = {
  id: string;
  command: PlayerBridgeCommandName;
  value?: boolean | number;
};

type PlayerBridgeResponse = {
  id: string;
  handled: boolean;
  value?: boolean | number;
};

const PLAYER_BRIDGE_EVENT = "media-hotkeys-player-bridge-command";
const PLAYER_BRIDGE_COMMAND_ATTR = "data-media-hotkeys-player-command";
const PLAYER_BRIDGE_RESPONSE_ATTR = "data-media-hotkeys-player-response";

function isPlayerBridgeCommand(value: unknown): value is PlayerBridgeCommand {
  if (!value || typeof value !== "object") {
    return false;
  }

  const command = value as Partial<PlayerBridgeCommand>;
  return typeof command.id === "string" && typeof command.command === "string";
}

function readBooleanProperty(host: HTMLElement, property: string): PlayerBridgeResponse {
  if (!(property in host)) {
    return { id: "", handled: false };
  }

  const value = (host as unknown as Record<string, unknown>)[property];
  return typeof value === "boolean" ? { id: "", handled: true, value } : { id: "", handled: false };
}

function readNumberProperty(host: HTMLElement, property: string): PlayerBridgeResponse {
  if (!(property in host)) {
    return { id: "", handled: false };
  }

  const value = (host as unknown as Record<string, unknown>)[property];
  return typeof value === "number" && Number.isFinite(value)
    ? { id: "", handled: true, value }
    : { id: "", handled: false };
}

function setProperty(host: HTMLElement, property: string, value: boolean | number): boolean {
  if (!(property in host)) {
    return false;
  }

  (host as unknown as Record<string, boolean | number>)[property] = value;
  return true;
}

function callMethod(host: HTMLElement, methodName: string): boolean {
  const method = (host as unknown as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    return false;
  }

  void method.call(host);
  return true;
}

function handleBridgeCommand(
  host: HTMLElement,
  command: PlayerBridgeCommand,
): PlayerBridgeResponse {
  try {
    switch (command.command) {
      case "play":
        return { id: command.id, handled: callMethod(host, "play") };

      case "pause":
        return { id: command.id, handled: callMethod(host, "pause") };

      case "setMuted":
        return {
          id: command.id,
          handled: typeof command.value === "boolean" && setProperty(host, "muted", command.value),
        };

      case "readMuted":
        return { ...readBooleanProperty(host, "muted"), id: command.id };

      case "setVolume":
        return {
          id: command.id,
          handled:
            typeof command.value === "number" &&
            command.value >= 0 &&
            command.value <= 1 &&
            setProperty(host, "volume", command.value),
        };

      case "readVolume":
        return { ...readNumberProperty(host, "volume"), id: command.id };

      case "setCurrentTime":
        return {
          id: command.id,
          handled:
            typeof command.value === "number" &&
            Number.isFinite(command.value) &&
            setProperty(host, "currentTime", command.value),
        };

      case "readCurrentTime":
        return { ...readNumberProperty(host, "currentTime"), id: command.id };

      case "readDuration":
        return { ...readNumberProperty(host, "duration"), id: command.id };

      case "setPlaybackRate":
        return {
          id: command.id,
          handled:
            typeof command.value === "number" &&
            Number.isFinite(command.value) &&
            setProperty(host, "playbackRate", command.value),
        };

      case "readPlaybackRate":
        return { ...readNumberProperty(host, "playbackRate"), id: command.id };

      case "requestFullscreen":
        return { id: command.id, handled: callMethod(host, "requestFullscreen") };

      default:
        return { id: command.id, handled: false };
    }
  } catch {
    return { id: command.id, handled: false };
  }
}

document.addEventListener(
  PLAYER_BRIDGE_EVENT,
  (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    const rawCommand = event.target.getAttribute(PLAYER_BRIDGE_COMMAND_ATTR);
    if (!rawCommand) {
      return;
    }

    try {
      const parsedCommand: unknown = JSON.parse(rawCommand);
      if (!isPlayerBridgeCommand(parsedCommand)) {
        return;
      }

      const response = handleBridgeCommand(event.target, parsedCommand);
      event.target.setAttribute(PLAYER_BRIDGE_RESPONSE_ATTR, JSON.stringify(response));
    } catch {
      event.target.setAttribute(
        PLAYER_BRIDGE_RESPONSE_ATTR,
        JSON.stringify({ id: "", handled: false } satisfies PlayerBridgeResponse),
      );
    }
  },
  true,
);
