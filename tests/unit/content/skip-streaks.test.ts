import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, resetContentTestState, showActionOverlayMock } from "./helpers.js";
import { handleAction, setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

describe("quick skip streak handling", () => {
  it("accumulates consecutive forward skip overlay amounts during the active overlay window", () => {
    vi.useFakeTimers();
    const video = makeVideo();

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardMedium", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      1,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: "forward" },
    );
    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekForwardMedium",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 15, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });

  it("starts a new backward skip streak after the overlay window expires", () => {
    vi.useFakeTimers();
    const video = makeVideo();

    handleAction("seekBackwardSmall", video);
    vi.advanceTimersByTime(
      DEFAULT_SETTINGS.advancedSettings.overlayVisibleDuration +
        DEFAULT_SETTINGS.advancedSettings.overlayFadeDuration +
        1,
    );
    handleAction("seekBackwardLarge", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      1,
      "seekBackwardSmall",
      video,
      "center-left",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: "backward" },
    );
    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekBackwardLarge",
      video,
      "center-left",
      expect.anything(),
      { seekSeconds: 30, animateSkipDirection: "backward" },
    );
    vi.useRealTimers();
  });

  it("extends the quick-skip streak window after each repeated skip", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const streakWindow =
      DEFAULT_SETTINGS.advancedSettings.overlayVisibleDuration +
      DEFAULT_SETTINGS.advancedSettings.overlayFadeDuration;

    handleAction("seekForwardSmall", video);
    vi.advanceTimersByTime(DEFAULT_SETTINGS.advancedSettings.overlayVisibleDuration);
    handleAction("seekForwardSmall", video);

    vi.advanceTimersByTime(DEFAULT_SETTINGS.advancedSettings.overlayFadeDuration + 1);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      3,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 15, animateSkipDirection: undefined },
    );

    vi.advanceTimersByTime(streakWindow + 1);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      4,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: "forward" },
    );
    vi.useRealTimers();
  });

  it("resets a backward quick-skip streak when the next skip would pass the beginning", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    video.currentTime = 8;

    handleAction("seekBackwardSmall", video);
    handleAction("seekBackwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekBackwardSmall",
      video,
      "center-left",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });

  it("resets a forward quick-skip streak when the next skip would pass the end", () => {
    vi.useFakeTimers();
    const video = makeVideo({ duration: 12 } as Partial<HTMLVideoElement>);
    video.currentTime = 2;

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });

  it("checks a custom-element player's own time and duration for the streak bounds", () => {
    vi.useFakeTimers();
    const host = document.createElement("custom-player");
    const video = document.createElement("video");
    host.attachShadow({ mode: "open" }).appendChild(video);
    document.body.appendChild(host);
    // The inner element is mid-media with no known end; the host is at the
    // start of a 100s item and ignores seeks, so it stays where it is.
    Object.defineProperty(video, "currentTime", { configurable: true, value: 50 });
    let hostTime = 2;
    Object.defineProperties(host, {
      currentTime: {
        configurable: true,
        get: () => hostTime,
        set: () => undefined,
      },
      duration: { configurable: true, get: () => 100 },
    });

    handleAction("seekBackwardSmall", video);
    handleAction("seekBackwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekBackwardSmall",
      video,
      "center-left",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: undefined },
    );

    // Now the host sits at the end, while the inner element could still seek on.
    hostTime = 98;
    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      4,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });

  it("replays the directional skip animation for repeated skips when sumQuickSkips is disabled", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.sumQuickSkips = false;
    setSettingsForTests(settings);

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      1,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: "forward" },
    );
    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekForwardSmall",
      video,
      "center-right",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: "forward" },
    );
    vi.useRealTimers();
  });

  it("uses the global overlay position and no skip animation when skip overlays inherit", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.overlayPosition = "bottom";
    settings.advancedSettings.skipOverlayPosition = "same as others";
    setSettingsForTests(settings);

    handleAction("seekForwardSmall", video);
    handleAction("seekForwardSmall", video);

    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      1,
      "seekForwardSmall",
      video,
      "bottom",
      expect.anything(),
      { seekSeconds: 5, animateSkipDirection: undefined },
    );
    expect(showActionOverlayMock).toHaveBeenNthCalledWith(
      2,
      "seekForwardSmall",
      video,
      "bottom",
      expect.anything(),
      { seekSeconds: 10, animateSkipDirection: undefined },
    );
    vi.useRealTimers();
  });
});
