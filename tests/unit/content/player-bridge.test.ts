import { describe, expect, it, vi } from "vitest";
import "../../../src/player-bridge.js";

const COMMAND_EVENT = "media-hotkeys-player-bridge-command";
const COMMAND_ATTR = "data-media-hotkeys-player-command";
const RESPONSE_ATTR = "data-media-hotkeys-player-response";

function sendBridgeCommand(
  host: HTMLElement,
  command: string,
): { id: string; handled: boolean; value?: unknown } | null {
  host.setAttribute(COMMAND_ATTR, JSON.stringify({ id: "test-id", command }));
  host.dispatchEvent(new CustomEvent(COMMAND_EVENT));
  const raw = host.getAttribute(RESPONSE_ATTR);
  return raw ? (JSON.parse(raw) as { id: string; handled: boolean }) : null;
}

function makeHost(methods: Record<string, unknown>): HTMLElement {
  const host = document.createElement("custom-player");
  Object.defineProperties(
    host,
    Object.fromEntries(
      Object.entries(methods).map(([name, value]) => [name, { configurable: true, value }]),
    ),
  );
  document.body.appendChild(host);
  return host;
}

describe("player bridge host methods", () => {
  it.each(["play", "pause", "requestFullscreen"])(
    "attaches a rejection handler to the promise %s() returns",
    async (command) => {
      const rejection = new Error("Refused");
      // A thenable records whether anything subscribed to its rejection.
      const then = vi.fn((_resolve?: () => void, reject?: (reason: unknown) => void) =>
        reject?.(rejection),
      );
      const host = makeHost({ [command]: vi.fn().mockReturnValue({ then }) });

      expect(sendBridgeCommand(host, command)).toEqual({ id: "test-id", handled: true });
      await vi.waitFor(() => {
        expect(then).toHaveBeenCalledOnce();
      });
      expect(then).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    },
  );

  it("reports a method that returns nothing as handled", () => {
    const pause = vi.fn();
    const host = makeHost({ pause });

    expect(sendBridgeCommand(host, "pause")).toEqual({ id: "test-id", handled: true });
    expect(pause).toHaveBeenCalledOnce();
  });

  it("reports a method whose result cannot be inspected as handled", () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("Hostile result");
        },
      },
    );
    const host = makeHost({ play: vi.fn().mockReturnValue(hostile) });

    expect(sendBridgeCommand(host, "play")).toEqual({ id: "test-id", handled: true });
  });

  it("reports a method that throws as not handled", () => {
    const host = makeHost({
      pause: vi.fn(() => {
        throw new Error("Broken");
      }),
    });

    expect(sendBridgeCommand(host, "pause")).toEqual({ id: "test-id", handled: false });
  });
});

describe("player bridge duration reads", () => {
  it("reports a finite duration as a value", () => {
    const host = makeHost({ duration: 90 });

    expect(sendBridgeCommand(host, "readDuration")).toEqual({
      id: "test-id",
      handled: true,
      value: 90,
    });
  });

  it.each([
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["-Infinity", -Infinity],
  ])("names a duration of %s, which JSON would turn into null", (name, duration) => {
    const host = makeHost({ duration });

    expect(sendBridgeCommand(host, "readDuration")).toEqual({
      id: "test-id",
      handled: true,
      nonFinite: name,
    });
  });

  it("doesn't handle a duration that isn't a number", () => {
    const host = makeHost({ duration: "unknown" });

    expect(sendBridgeCommand(host, "readDuration")).toEqual({ id: "test-id", handled: false });
  });

  it("still ignores a non-finite value for the other numbers", () => {
    const host = makeHost({ volume: NaN, currentTime: Infinity });

    expect(sendBridgeCommand(host, "readVolume")).toEqual({ id: "test-id", handled: false });
    expect(sendBridgeCommand(host, "readCurrentTime")).toEqual({ id: "test-id", handled: false });
  });
});
