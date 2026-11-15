import { beforeEach, describe, expect, it } from "vitest";
import { makeVideo, resetContentTestState, setSeekable, showActionOverlayMock } from "./helpers.js";
import { handleAction } from "../../../src/content.js";
import { actionedMedia, state } from "../../../src/content/state.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

type VideoOverrides = Partial<HTMLVideoElement>;

function makeLiveDvr(currentTime = 800): HTMLVideoElement {
  const video = makeVideo({ duration: Infinity, currentTime } as VideoOverrides);
  setSeekable(video, [400, 1000]);
  return video;
}

async function pressKey(key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  // The key is dispatched to the target media asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return event;
}

describe("default bindings", () => {
  it("bind End to jump to live and add Home to restart", () => {
    expect(DEFAULT_SETTINGS.quickSettings.actionKeyBindings.seekToLive.keys).toEqual(["End"]);
    expect(DEFAULT_SETTINGS.quickSettings.actionKeyBindings.restart.keys).toEqual(["r", "Home"]);
    expect(state.keyToActionMap.get("End")).toBe("seekToLive");
    expect(state.keyToActionMap.get("Home")).toBe("restart");
  });
});

describe("seekToLive", () => {
  it("goes to the live edge of a live stream that can rewind and shows LIVE", () => {
    const video = makeLiveDvr();

    handleAction("seekToLive", video);

    expect(video.currentTime).toBe(1000);
    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "seekToLive",
      video,
      "center",
      expect.anything(),
      {},
    );
  });

  it.each([
    [
      "a live stream that can't rewind",
      () => {
        const video = makeVideo({ duration: Infinity, currentTime: 800 } as VideoOverrides);
        setSeekable(video, null);
        return video;
      },
    ],
    ["a vod", () => makeVideo({ duration: 1200, currentTime: 800 } as VideoOverrides)],
    [
      "media with an unknown duration",
      () => makeVideo({ duration: NaN, currentTime: 800 } as VideoOverrides),
    ],
  ])("does nothing, with no overlay, on %s", (_name, make) => {
    const video = make();

    handleAction("seekToLive", video);

    expect(video.currentTime).toBe(800);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("doesn't make media it can't jump on the one later keys target", () => {
    const video = makeVideo({ duration: Infinity, currentTime: 800 } as VideoOverrides);
    setSeekable(video, null);

    handleAction("seekToLive", video);

    expect(state.lastActionedMedia).not.toBe(video);
    expect(actionedMedia.has(video)).toBe(false);
  });

  it("uses the host's duration to tell a custom player's stream is live", () => {
    const host = document.createElement("custom-player");
    const video = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(video);
    document.body.appendChild(host);
    let hostTime = 800;
    Object.defineProperties(host, {
      duration: { configurable: true, get: () => Infinity },
      currentTime: { configurable: true, get: () => hostTime, set: (v: number) => (hostTime = v) },
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 1200 });
    setSeekable(video, [400, 1000]);

    handleAction("seekToLive", video);

    expect(hostTime).toBe(1000);
  });
});

describe("whether an action was handled", () => {
  it("is true for a skip that can't move because the playhead is at the live edge", () => {
    const video = makeLiveDvr(1000);

    expect(handleAction("seekForwardSmall", video)).toBe(true);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(actionedMedia.has(video)).toBe(false);
  });

  it.each([
    ["restart", "restart", 400],
    ["a jump to live", "seekToLive", 1000],
  ] as const)("is true for %s when the live stream already sits there", (_name, action, time) => {
    const video = makeLiveDvr(time);

    expect(handleAction(action, video)).toBe(true);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(state.lastActionedMedia).not.toBe(video);
    expect(actionedMedia.has(video)).toBe(false);
  });

  it("still restarts a vod that is already at the start, as before", () => {
    const vod = makeVideo({ duration: 1200, currentTime: 0 } as VideoOverrides);

    expect(handleAction("restart", vod)).toBe(true);
    expect(showActionOverlayMock).toHaveBeenCalledTimes(1);
  });

  it("is false for media that can't act on it at all, so another frame's media can", () => {
    const noDvr = makeVideo({ duration: Infinity, currentTime: 800 } as VideoOverrides);
    setSeekable(noDvr, null);
    const vod = makeVideo({ duration: 1200, currentTime: 800 } as VideoOverrides);

    expect(handleAction("seekForwardSmall", noDvr)).toBe(false);
    expect(handleAction("seekToLive", vod)).toBe(false);
  });

  it("is true for a jump that moved", () => {
    expect(handleAction("seekToLive", makeLiveDvr())).toBe(true);
  });
});

describe("the End and Home keys", () => {
  it("take End to jump to the live edge of a stream that can rewind", async () => {
    const video = makeLiveDvr();

    const event = await pressKey("End");

    expect(event.defaultPrevented).toBe(true);
    expect(video.currentTime).toBe(1000);
  });

  it("leave End to the page when the media has nowhere to jump to", async () => {
    const vod = makeVideo({ duration: 1200, currentTime: 800 } as VideoOverrides);

    const event = await pressKey("End");

    expect(event.defaultPrevented).toBe(false);
    expect(vod.currentTime).toBe(800);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("take Home to restart", async () => {
    const vod = makeVideo({ duration: 1200, currentTime: 800 } as VideoOverrides);

    const event = await pressKey("Home");

    expect(event.defaultPrevented).toBe(true);
    expect(vod.currentTime).toBe(0);
  });

  it("take Home to go to the start of a live stream's window", async () => {
    const video = makeLiveDvr();

    await pressKey("Home");

    expect(video.currentTime).toBe(400);
  });
});
