import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, resetContentTestState, setSeekable, showActionOverlayMock } from "./helpers.js";
import { actionedMedia, state } from "../../../src/content/state.js";
import { handleAction } from "../../../src/content.js";
import { readMediaTimeline } from "../../../src/content/player-control.js";

beforeEach(() => {
  resetContentTestState();
});

type VideoOverrides = Partial<HTMLVideoElement>;

// A live stream with a window to rewind through: the playhead is 200s behind a
// live edge at 1000s, and the window starts at 400s (600s long).
function makeLiveDvr(overrides: VideoOverrides = {}): HTMLVideoElement {
  const video = makeVideo({ duration: Infinity, currentTime: 800, ...overrides });
  setSeekable(video, [400, 1000]);
  return video;
}

function makeLiveWithoutDvr(): HTMLVideoElement {
  const video = makeVideo({ duration: Infinity, currentTime: 800 } as VideoOverrides);
  setSeekable(video, null);
  return video;
}

describe("media timeline", () => {
  it("is vod for a finite, positive duration", () => {
    const video = makeVideo({ duration: 90 } as VideoOverrides);

    expect(readMediaTimeline(video)).toEqual({ kind: "vod", range: { start: 0, end: 90 } });
  });

  it("is live with the seekable window for an infinite duration", () => {
    expect(readMediaTimeline(makeLiveDvr())).toEqual({
      kind: "live",
      range: { start: 400, end: 1000 },
    });
  });

  it("uses only the last of several seekable ranges, which ends at the live edge", () => {
    const video = makeVideo({ duration: Infinity } as VideoOverrides);
    Object.defineProperty(video, "seekable", {
      configurable: true,
      value: { length: 2, start: (i: number) => [400, 700][i], end: (i: number) => [600, 1000][i] },
    });

    expect(readMediaTimeline(video).range).toEqual({ start: 700, end: 1000 });
  });

  it.each([
    ["has no seekable range", null],
    ["has an infinite seekable end", [0, Infinity]],
    ["has an empty seekable range", [5, 5]],
  ] as const)("is live without a range when it %s", (_name, window) => {
    const video = makeVideo({ duration: Infinity } as VideoOverrides);
    setSeekable(video, window ? [window[0], window[1]] : null);

    expect(readMediaTimeline(video)).toEqual({ kind: "live", range: null });
  });

  it("is live without a range when seekable throws or is missing", () => {
    const throwing = makeVideo({ duration: Infinity } as VideoOverrides);
    Object.defineProperty(throwing, "seekable", {
      configurable: true,
      get: () => {
        throw new Error("Broken");
      },
    });
    const missing = makeVideo({ duration: Infinity } as VideoOverrides);
    Object.defineProperty(missing, "seekable", { configurable: true, value: undefined });

    expect(readMediaTimeline(throwing)).toEqual({ kind: "live", range: null });
    expect(readMediaTimeline(missing)).toEqual({ kind: "live", range: null });
  });

  it.each([NaN, 0, -1, -Infinity])("is unknown for a duration of %s", (duration) => {
    const video = makeVideo({ duration } as VideoOverrides);
    setSeekable(video, [0, 50]);

    expect(readMediaTimeline(video)).toEqual({ kind: "unknown", range: null });
  });
});

describe("number keys", () => {
  it("seek a vod like any finite media", () => {
    const video = makeVideo({ duration: 200, currentTime: 10 } as VideoOverrides);

    handleAction("seekToPercent30", video);

    expect(video.currentTime).toBe(60);
  });

  it.each([
    ["a live stream that can rewind", () => makeLiveDvr()],
    ["a live stream that can't rewind", makeLiveWithoutDvr],
    [
      "media with an unknown duration",
      () => makeVideo({ duration: NaN, currentTime: 800 } as VideoOverrides),
    ],
  ])("are ignored without an overlay for %s", (_name, make) => {
    const video = make();

    for (const action of ["seekToPercent0", "seekToPercent50", "seekToPercent90"] as const) {
      expect(() => handleAction(action, video)).not.toThrow();
    }

    expect(video.currentTime).toBe(800);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });
});

describe("actions with nothing to act on", () => {
  it("don't make the media the one later keys target", () => {
    const video = makeLiveWithoutDvr();

    handleAction("seekToPercent50", video);
    handleAction("seekForwardSmall", video);
    handleAction("restart", video);

    expect(state.lastActionedMedia).not.toBe(video);
    expect(actionedMedia.has(video)).toBe(false);
  });

  it("do make it the target once an action moves it", () => {
    const video = makeLiveDvr();

    handleAction("restart", video);

    expect(state.lastActionedMedia).toBe(video);
    expect(actionedMedia.has(video)).toBe(true);
  });
});

describe("restart", () => {
  it("goes to the start of a live stream's window and reports the time behind live", () => {
    const video = makeLiveDvr();

    handleAction("restart", video);

    expect(video.currentTime).toBe(400);
    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "restart",
      video,
      "center",
      expect.anything(),
      { timestampSeconds: 0, jumpDirection: "backward", behindLiveSeconds: 600 },
    );
  });

  it("does nothing, with no overlay, for a live stream that can't rewind", () => {
    const video = makeLiveWithoutDvr();

    handleAction("restart", video);

    expect(video.currentTime).toBe(800);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("still goes to zero for a vod and for media whose duration isn't known yet", () => {
    const vod = makeVideo({ duration: 100, currentTime: 40 } as VideoOverrides);
    const unknown = makeVideo({ duration: NaN, currentTime: 40 } as VideoOverrides);

    handleAction("restart", vod);
    handleAction("restart", unknown);

    expect(vod.currentTime).toBe(0);
    expect(unknown.currentTime).toBe(0);
  });
});

describe("skips", () => {
  it("stay inside a live stream's window", () => {
    const video = makeLiveDvr({ currentTime: 990 } as VideoOverrides);

    handleAction("seekForwardLarge", video);
    expect(video.currentTime).toBe(1000);

    video.currentTime = 410;
    handleAction("seekBackwardLarge", video);
    expect(video.currentTime).toBe(400);
  });

  it("do nothing, with no overlay, for a live stream that can't rewind", () => {
    const video = makeLiveWithoutDvr();

    handleAction("seekBackwardSmall", video);
    handleAction("seekForwardMedium", video);

    expect(video.currentTime).toBe(800);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("move media whose duration isn't known yet, as before", () => {
    const video = makeVideo({ duration: NaN, currentTime: 20 } as VideoOverrides);

    handleAction("seekForwardSmall", video);

    expect(video.currentTime).toBe(25);
    expect(showActionOverlayMock).toHaveBeenCalledTimes(1);
  });

  it("do nothing, with no overlay, once the playhead is at the edge being skipped toward", () => {
    const atLiveEdge = makeLiveDvr({ currentTime: 1000 } as VideoOverrides);
    const atWindowStart = makeLiveDvr({ currentTime: 400 } as VideoOverrides);

    handleAction("seekForwardSmall", atLiveEdge);
    handleAction("seekBackwardSmall", atWindowStart);

    expect(atLiveEdge.currentTime).toBe(1000);
    expect(atWindowStart.currentTime).toBe(400);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("show the move that reached the edge, then nothing for the skip that can't move", () => {
    vi.useFakeTimers();
    const video = makeLiveDvr({ currentTime: 995 } as VideoOverrides);

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(video.currentTime).toBe(1000);
    expect(showActionOverlayMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("don't end a streak at zero when the window starts later", () => {
    vi.useFakeTimers();
    const video = makeLiveDvr({ currentTime: 900 } as VideoOverrides);

    handleAction("seekBackwardSmall", video);
    handleAction("seekBackwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekBackwardSmall",
      video,
      "center-left",
      expect.anything(),
      { seekSeconds: 10, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });
});
