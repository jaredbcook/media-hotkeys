import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../src/player-bridge.js";
import { makeCustomPlayerVideo, resetContentTestState } from "./helpers.js";
import {
  getEffectiveVolume,
  pauseMedia,
  playMedia,
  readPlayerCurrentTime,
  readPlayerDuration,
  readPlayerMuted,
  readPlayerPaused,
  readPlayerPlaybackRate,
  readPlayerPlaying,
  readPlayerVolume,
  setPlayerCurrentTime,
  setPlayerMuted,
  setPlayerPlaybackRate,
  setPlayerVolume,
} from "../../../src/content/player-control.js";

beforeEach(() => {
  resetContentTestState();
});

function throwingGetter(): () => never {
  return () => {
    throw new Error("The player isn't ready");
  };
}

function define(target: object, name: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}

// A host whose getter always throws, over an inner video that holds the value
// the helper has to fall back to.
function makeThrowingPlayer(
  hostProperty: string,
  innerProperty: string,
  innerValue: unknown,
): ReturnType<typeof makeCustomPlayerVideo> {
  const player = makeCustomPlayerVideo();
  define(player.host, hostProperty, { get: throwingGetter() });
  define(player.video, innerProperty, { value: innerValue });
  return player;
}

// The direct read throws, then the bridge's read finds the value. Both share
// one world here, so the getter stands in for a host the content script can't
// see until the main-world bridge asks it.
function makeBridgedPlayer(
  hostProperty: string,
  hostValue: unknown,
  innerProperty: string,
  innerValue: unknown,
): ReturnType<typeof makeCustomPlayerVideo> {
  const player = makeCustomPlayerVideo();
  const get = vi.fn().mockImplementationOnce(throwingGetter()).mockReturnValue(hostValue);
  define(player.host, hostProperty, { get });
  define(player.video, innerProperty, { value: innerValue });
  return player;
}

describe("a custom player host whose getter throws", () => {
  it.each([
    ["readPlayerPaused", "paused", readPlayerPaused, true],
    ["readPlayerMuted", "muted", readPlayerMuted, true],
  ])("falls back to the element in %s", (_name, property, read, innerValue) => {
    const { video } = makeThrowingPlayer(property, property, innerValue);

    expect(() => read(video)).not.toThrow();
    expect(read(video)).toBe(innerValue);
  });

  it.each([
    ["readPlayerVolume", "volume", readPlayerVolume, 0.4],
    ["readPlayerCurrentTime", "currentTime", readPlayerCurrentTime, 33],
    ["readPlayerDuration", "duration", readPlayerDuration, 120],
    ["readPlayerPlaybackRate", "playbackRate", readPlayerPlaybackRate, 1.5],
  ])("falls back to the element in %s", (_name, property, read, innerValue) => {
    const { video } = makeThrowingPlayer(property, property, innerValue);

    expect(() => read(video)).not.toThrow();
    expect(read(video)).toBe(innerValue);
  });

  it("judges readPlayerPlaying from the element", () => {
    const { video } = makeThrowingPlayer("paused", "paused", false);
    define(video, "ended", { value: false });
    define(video, "readyState", { value: 4 });

    expect(() => readPlayerPlaying(video)).not.toThrow();
    expect(readPlayerPlaying(video)).toBe(true);
  });

  it("reads getEffectiveVolume from the element when the host's volume and muted both throw", () => {
    const { host, video } = makeThrowingPlayer("volume", "volume", 0.6);
    define(host, "muted", { get: throwingGetter() });
    define(video, "muted", { value: false });

    expect(() => getEffectiveVolume(video)).not.toThrow();
    expect(getEffectiveVolume(video)).toBe(0.6);
  });

  it.each([
    ["readPlayerPaused", "paused", readPlayerPaused, true, false],
    ["readPlayerMuted", "muted", readPlayerMuted, true, false],
    ["readPlayerVolume", "volume", readPlayerVolume, 0.25, 0.9],
    ["readPlayerCurrentTime", "currentTime", readPlayerCurrentTime, 12, 33],
    ["readPlayerDuration", "duration", readPlayerDuration, 80, 120],
    ["readPlayerPlaybackRate", "playbackRate", readPlayerPlaybackRate, 2, 1],
  ])("moves on to the bridge in %s", (_name, property, read, hostValue, innerValue) => {
    const { video } = makeBridgedPlayer(property, hostValue, property, innerValue);

    expect(read(video)).toBe(hostValue);
  });

  it("moves on to the bridge in readPlayerPlaying", () => {
    const { video } = makeBridgedPlayer("paused", false, "paused", true);

    expect(readPlayerPlaying(video)).toBe(true);
  });

  it("pauses the element when the host's pause getter throws", () => {
    const { host, video } = makeCustomPlayerVideo();
    define(host, "pause", { get: throwingGetter() });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});

    expect(() => pauseMedia(video)).not.toThrow();

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("plays the element when the host's play getter throws", async () => {
    const { host, video } = makeCustomPlayerVideo();
    define(host, "play", { get: throwingGetter() });
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);

    playMedia(video);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });
});

// A host that inherits through a proxy whose `has` trap throws, so `in` itself
// throws before any getter runs. The proxy wraps an object that inherits from
// the host's own prototype, so the host is still an HTMLElement. The host has no
// own properties of its own, or `in` would answer from them without reaching it.
function makeProxiedHostPlayer(): ReturnType<typeof makeCustomPlayerVideo> {
  const player = makeCustomPlayerVideo();
  const prototype = new Proxy(
    Object.create(Object.getPrototypeOf(player.host) as object) as object,
    {
      has() {
        throw new Error("The player isn't ready");
      },
    },
  );
  Object.setPrototypeOf(player.host, prototype);
  return player;
}

describe("a custom player host whose `in` check throws", () => {
  it.each([
    ["readPlayerPaused", "paused", readPlayerPaused, true],
    ["readPlayerMuted", "muted", readPlayerMuted, true],
    ["readPlayerVolume", "volume", readPlayerVolume, 0.4],
    ["readPlayerCurrentTime", "currentTime", readPlayerCurrentTime, 33],
    ["readPlayerDuration", "duration", readPlayerDuration, 120],
    ["readPlayerPlaybackRate", "playbackRate", readPlayerPlaybackRate, 1.5],
  ])("falls back to the element in %s", (_name, property, read, innerValue) => {
    const { video } = makeProxiedHostPlayer();
    define(video, property, { value: innerValue });

    expect(() => read(video)).not.toThrow();
    expect(read(video)).toBe(innerValue);
  });

  it("falls back to the element when a write's `in` check throws", () => {
    const { video } = makeProxiedHostPlayer();

    expect(() => setPlayerMuted(video, true)).not.toThrow();
    expect(() => setPlayerVolume(video, 0.3)).not.toThrow();
    expect(() => setPlayerCurrentTime(video, 21)).not.toThrow();
    expect(() => setPlayerPlaybackRate(video, 2)).not.toThrow();

    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.3);
    expect(video.currentTime).toBe(21);
    expect(video.playbackRate).toBe(2);
  });
});
