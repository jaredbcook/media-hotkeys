import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { sync: { get: vi.fn(async (d: unknown) => d), set: vi.fn() } },
  },
}));

import { showActionOverlay } from "../src/overlay.js";
import { DEFAULT_SETTINGS, type GlobalSettings } from "../src/storage.js";

const globalSettings: GlobalSettings = DEFAULT_SETTINGS;

function makeVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  document.body.appendChild(video);
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 640,
    height: 360,
    right: 740,
    bottom: 460,
    x: 100,
    y: 100,
    toJSON: () => {},
  });
  return video;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("showActionOverlay", () => {
  it("creates the overlay element on first call", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay");
    expect(el).not.toBeNull();
  });

  it("shows the overlay as flex", () => {
    const video = makeVideo();
    showActionOverlay("toggleMute", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.display).toBe("flex");
  });

  it("displays 0% when muted", () => {
    const video = makeVideo();
    video.volume = 0.75;
    video.muted = true;
    showActionOverlay("toggleMute", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("0%");
  });

  it("displays the current volume percentage when unmuted", () => {
    const video = makeVideo();
    video.volume = 0.75;
    video.muted = false;
    showActionOverlay("toggleMute", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("75%");
  });

  it("displays play icon when media is playing (toggled from paused)", () => {
    const video = makeVideo();
    Object.defineProperty(video, "paused", { value: false, writable: true });
    showActionOverlay("togglePlayPause", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("<svg");
  });

  it("displays volume percentage for volume actions", () => {
    const video = makeVideo();
    video.volume = 0.75;
    showActionOverlay("volumeUp", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("75%");
  });

  it("shows the mute icon when volume down reaches zero", () => {
    const video = makeVideo();
    video.volume = 0;
    showActionOverlay("volumeDown", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("M671-177q-11 7-22 13");
  });

  it("shows the volume down icon when muted but volume remains above zero", () => {
    const video = makeVideo();
    video.volume = 0.4;
    video.muted = true;
    showActionOverlay("volumeDown", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("M200-360v-240h160l200-200v640");
  });

  it("displays playback rate for speed actions", () => {
    const video = makeVideo();
    video.playbackRate = 1.5;
    showActionOverlay("speedUp", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("1.5x");
  });

  it("displays seek step for seek actions", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardLarge", video, "center-right", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("+30s");
  });

  it("displays negative seek step for backward seek", () => {
    const video = makeVideo();
    showActionOverlay("seekBackwardSmall", video, "center-left", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("-5s");
  });

  it("displays the medium seek step for medium seek actions", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardMedium", video, "center-right", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("+10s");
  });

  it("displays accumulated seek seconds when provided", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardMedium", video, "center-right", globalSettings, {
      seekSeconds: 40,
    });
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.innerHTML).toContain("+40s");
  });

  it("hides the overlay after the duration elapses", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.display).toBe("flex");

    vi.advanceTimersByTime(
      globalSettings.overlayVisibleDuration + globalSettings.overlayFadeDuration + 150,
    );
    expect(el.style.display).toBe("none");
  });

  it("reuses the same element across calls", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "center", globalSettings);
    showActionOverlay("toggleMute", video, "center", globalSettings);
    const els = document.querySelectorAll("#media-shortcuts-overlay");
    expect(els.length).toBe(1);
  });

  it("does not show overlay for seek-to-percent actions (no content)", () => {
    const video = makeVideo();
    showActionOverlay("seekToPercent50", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay");
    expect(el).toBeNull();
  });

  it("does not show overlay for fullscreen or picture-in-picture toggles", () => {
    const video = makeVideo();

    showActionOverlay("toggleFullscreen", video, "center", globalSettings);
    showActionOverlay("togglePip", video, "center", globalSettings);

    const el = document.getElementById("media-shortcuts-overlay");
    expect(el).toBeNull();
  });

  it("positions overlay centered over the media element", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "center", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.transform).toBe("translate(-50%, -50%)");
    // 100 + 640/2 = 420
    expect(el.style.left).toBe("420px");
    // 100 + 360/2 = 280
    expect(el.style.top).toBe("280px");
  });

  it("positions overlay at top-left with inset", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "top-left", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.transform).toBe("translate(0%, 0%)");
    expect(el.style.left).toBe("112px"); // 100 + 12 inset
    expect(el.style.top).toBe("112px");
  });

  it("positions overlay at center-right with inset", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardSmall", video, "center-right", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.transform).toBe("translate(-100%, -50%)");
    expect(el.style.left).toBe("728px"); // 740 - 12 inset
    expect(el.style.top).toBe("280px"); // 100 + 360/2
  });

  it("positions overlay at bottom with inset", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "bottom", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;
    expect(el.style.transform).toBe("translate(-50%, -100%)");
    expect(el.style.left).toBe("420px"); // center horizontal
    expect(el.style.top).toBe("448px"); // 460 - 12 inset
  });

  it("uses custom global settings for timing", () => {
    const video = makeVideo();
    const customSettings: GlobalSettings = {
      ...globalSettings,
      overlayVisibleDuration: 1000,
      overlayFadeDuration: 500,
    };
    showActionOverlay("togglePlayPause", video, "center", customSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;

    // Still visible after default timing would have hidden it
    vi.advanceTimersByTime(800);
    expect(el.style.display).toBe("flex");

    // Hidden after custom timing
    vi.advanceTimersByTime(1000 + 500 + 50);
    expect(el.style.display).toBe("none");
  });

  it("animates the first forward skip with a right slide", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardSmall", video, "center-right", globalSettings, {
      animateSkipDirection: "forward",
    });
    const el = document.getElementById("media-shortcuts-overlay")!;

    expect(el.style.animation).toContain("media-shortcuts-skip-slide");
    expect(el.style.getPropertyValue("--media-shortcuts-slide-from-x")).toBe("-20%");
  });

  it("does not animate when no skip animation direction is provided", () => {
    const video = makeVideo();
    showActionOverlay("seekBackwardSmall", video, "center-left", globalSettings);
    const el = document.getElementById("media-shortcuts-overlay")!;

    expect(el.style.animation).toBe("none");
  });
});
