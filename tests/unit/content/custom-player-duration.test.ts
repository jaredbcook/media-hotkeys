import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../src/player-bridge.js";
import {
  makeCustomPlayerVideo,
  resetContentTestState,
  setSeekable,
  showActionOverlayMock,
} from "./helpers.js";
import { handleAction } from "../../../src/content.js";
import { readPlayerDuration } from "../../../src/content/player-control.js";

beforeEach(() => {
  resetContentTestState();
});

function makePlayer(
  hostDuration: unknown,
  innerDuration: number,
): ReturnType<typeof makeCustomPlayerVideo> {
  const player = makeCustomPlayerVideo();
  Object.defineProperty(player.video, "duration", { configurable: true, value: innerDuration });
  Object.defineProperty(player.host, "duration", { configurable: true, value: hostDuration });
  return player;
}

// The content script's isolated world can't see properties a page defines on
// its elements, so it asks the main-world bridge. Here both share one world, so
// the first read, which is the direct one, finds nothing usable and the second,
// which is the bridge's, finds the value.
function makeBridgedPlayer(
  hostDuration: unknown,
  innerDuration: number,
): ReturnType<typeof makeCustomPlayerVideo> {
  const player = makeCustomPlayerVideo();
  Object.defineProperty(player.video, "duration", { configurable: true, value: innerDuration });
  const reads = vi.fn().mockReturnValueOnce(undefined).mockReturnValue(hostDuration);
  Object.defineProperty(player.host, "duration", { configurable: true, get: reads });
  return player;
}

describe("a custom player host's duration", () => {
  it.each([
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["a finite value", 90],
  ])("is used when the host reports %s over a different inner duration", (_name, hostDuration) => {
    const { video } = makePlayer(hostDuration, 120);

    expect(readPlayerDuration(video)).toBe(hostDuration);
  });

  it("falls back to the inner duration when the host's isn't a number", () => {
    const { video } = makePlayer("unknown", 120);

    expect(readPlayerDuration(video)).toBe(120);
  });

  it.each([
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["-Infinity", -Infinity],
    ["a finite value", 90],
  ])("is read through the bridge when the host reports %s", (_name, hostDuration) => {
    const { video } = makeBridgedPlayer(hostDuration, 120);

    expect(readPlayerDuration(video)).toBe(hostDuration);
  });

  it("falls back to the inner duration when the bridge can't read one", () => {
    const { video } = makeBridgedPlayer("unknown", 120);

    expect(readPlayerDuration(video)).toBe(120);
  });

  it.each([Infinity, NaN])(
    "stops percent seeks when the host reports %s over a finite inner duration",
    (hostDuration) => {
      const { video } = makePlayer(hostDuration, 120);
      video.currentTime = 7;

      expect(() => handleAction("seekToPercent50", video)).not.toThrow();

      expect(video.currentTime).toBe(7);
    },
  );

  it("leaves the end of a skip streak unbounded when the host reports Infinity", () => {
    vi.useFakeTimers();
    const { host, video } = makePlayer(Infinity, 100);
    // The inner element's own span is finite, but the host says the stream has no end.
    setSeekable(video, [0, 200]);
    Object.defineProperty(host, "currentTime", {
      configurable: true,
      get: () => 98,
      set: () => {},
    });

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 10, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });
});
