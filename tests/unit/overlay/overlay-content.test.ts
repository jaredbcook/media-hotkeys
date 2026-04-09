import { describe, expect, it } from "vitest";
import { getOverlayElement, makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS, type AdvancedSettings } from "../../../src/storage.js";

const advancedSettings: AdvancedSettings = DEFAULT_ADVANCED_SETTINGS;

describe("overlay content", () => {
  it("renders the expected state for mute, play, speed, seek, restart, and overlay toggle actions", () => {
    const video = makeVideo();
    video.volume = 0.75;
    video.muted = true;
    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("0%");

    video.muted = false;
    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("75%");

    Object.defineProperty(video, "paused", { value: false, writable: true });
    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("<svg");

    video.playbackRate = 1.5;
    showActionOverlay("speedUp", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("1.5x");

    showActionOverlay("seekForwardLarge", video, "center-right", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("+30s");

    Object.defineProperty(video, "duration", { configurable: true, value: 120, writable: true });
    showActionOverlay("restart", video, "center", advancedSettings);
    expect(getOverlayElement()?.textContent).toBe("0:00");

    showActionOverlay("toggleOverlays", video, "center", advancedSettings, {
      overlayEnabled: true,
    });
    expect(getOverlayElement()?.textContent).toBe("Overlays on");
    expect(getOverlayElement()?.querySelector("svg")).toBeNull();

    showActionOverlay("toggleOverlays", video, "center", advancedSettings, {
      overlayEnabled: false,
    });
    expect(getOverlayElement()?.textContent).toBe("Overlays off");
    expect(getOverlayElement()?.querySelector("svg")).toBeNull();
  });

  it("renders the expected volume icons for volume actions", () => {
    const video = makeVideo();
    video.volume = 0.75;
    showActionOverlay("volumeUp", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("75%");

    video.volume = 0;
    showActionOverlay("volumeDown", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("M671-177q-11 7-22 13");

    video.volume = 0.4;
    video.muted = true;
    showActionOverlay("volumeDown", video, "center", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("M200-360v-240h160l200-200v640");
  });

  it("renders backward and medium seek labels and accumulated seek amounts", () => {
    const video = makeVideo();

    showActionOverlay("seekBackwardSmall", video, "center-left", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("-5s");

    showActionOverlay("seekForwardMedium", video, "center-right", advancedSettings);
    expect(getOverlayElement()?.innerHTML).toContain("+10s");

    showActionOverlay("seekForwardMedium", video, "center-right", advancedSettings, {
      seekSeconds: 40,
    });
    expect(getOverlayElement()?.innerHTML).toContain("+40s");
  });

  it("renders mm:ss and hh:mm:ss timestamps for percent seek actions", () => {
    const shortVideo = makeVideo();
    Object.defineProperty(shortVideo, "duration", {
      configurable: true,
      value: 3599,
      writable: true,
    });
    showActionOverlay("seekToPercent50", shortVideo, "center", advancedSettings, {
      timestampSeconds: 743,
      jumpDirection: "forward",
    });
    expect(getOverlayElement()?.textContent).toBe("12:23");
    expect(getOverlayElement()?.innerHTML).toContain("M480-120q-75 0-140.5-28.5");

    const longVideo = makeVideo();
    Object.defineProperty(longVideo, "duration", {
      configurable: true,
      value: 3600,
      writable: true,
    });
    showActionOverlay("seekToPercent50", longVideo, "center", advancedSettings, {
      timestampSeconds: 3752,
      jumpDirection: "backward",
    });
    expect(getOverlayElement()?.textContent).toBe("1:02:32");
    expect(getOverlayElement()?.innerHTML).toContain("M480-120q-138 0-240.5-91.5");
  });

  it("does not render overlays for fullscreen or picture-in-picture toggles", () => {
    const video = makeVideo();

    showActionOverlay("toggleFullscreen", video, "center", advancedSettings);
    showActionOverlay("togglePip", video, "center", advancedSettings);

    expect(getOverlayElement()).toBeNull();
  });
});
