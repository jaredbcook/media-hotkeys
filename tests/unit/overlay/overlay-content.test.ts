import { describe, expect, it } from "vitest";
import { getOverlayBox, makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS, type AdvancedSettings } from "../../../src/storage.js";

const advancedSettings: AdvancedSettings = DEFAULT_ADVANCED_SETTINGS;

describe("overlay content", () => {
  it("renders the expected state for mute, play, speed, seek, restart, and overlay toggle actions", () => {
    const video = makeVideo();
    video.volume = 0.75;
    video.muted = true;
    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("0%");

    video.muted = false;
    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("75%");

    Object.defineProperty(video, "paused", { value: false, writable: true });
    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("<svg");

    video.playbackRate = 1.5;
    showActionOverlay("speedUp", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("1.5x");

    video.playbackRate = 1.1500000000000001;
    showActionOverlay("speedUp", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("1.15x");

    showActionOverlay("seekForwardLarge", video, "center-right", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("+30s");

    Object.defineProperty(video, "duration", { configurable: true, value: 120, writable: true });
    showActionOverlay("restart", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("0:00");

    showActionOverlay("toggleOverlays", video, "center", advancedSettings, {
      overlayEnabled: true,
    });
    expect(getOverlayBox()?.textContent).toBe("Overlays on");
    expect(getOverlayBox()?.querySelector("svg")).toBeNull();

    showActionOverlay("toggleOverlays", video, "center", advancedSettings, {
      overlayEnabled: false,
    });
    expect(getOverlayBox()?.textContent).toBe("Overlays off");
    expect(getOverlayBox()?.querySelector("svg")).toBeNull();
  });

  it("renders the expected volume icons for volume actions", () => {
    const video = makeVideo();
    video.volume = 0.75;
    showActionOverlay("volumeUp", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("75%");

    video.volume = 0;
    showActionOverlay("volumeDown", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("M671-177q-11 7-22 13");

    video.volume = 0.4;
    video.muted = true;
    showActionOverlay("volumeDown", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("M200-360v-240h160l200-200v640");
  });

  it("renders backward and medium seek labels and accumulated seek amounts", () => {
    const video = makeVideo();

    showActionOverlay("seekBackwardSmall", video, "center-left", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("-5s");

    showActionOverlay("seekForwardMedium", video, "center-right", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("+10s");

    showActionOverlay("seekForwardMedium", video, "center-right", advancedSettings, {
      seekSeconds: 40,
    });
    expect(getOverlayBox()?.innerHTML).toContain("+40s");
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
    expect(getOverlayBox()?.textContent).toBe("12:23");
    expect(getOverlayBox()?.innerHTML).toContain("M480-120q-75 0-140.5-28.5");

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
    expect(getOverlayBox()?.textContent).toBe("1:02:32");
    expect(getOverlayBox()?.innerHTML).toContain("M480-120q-138 0-240.5-91.5");
  });

  it("reads paused, muted, volume, and playbackRate from a custom-element player host", () => {
    const host = document.createElement("custom-player");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    shadowRoot.appendChild(video);
    document.body.appendChild(host);

    video.volume = 1;
    video.muted = false;
    video.playbackRate = 1;
    Object.defineProperty(video, "paused", { configurable: true, value: true, writable: true });

    let hostPaused = false;
    let hostMuted = true;
    let hostVolume = 0.35;
    let hostPlaybackRate = 1.75;

    Object.defineProperties(host, {
      paused: {
        configurable: true,
        get: () => hostPaused,
      },
      muted: {
        configurable: true,
        get: () => hostMuted,
      },
      volume: {
        configurable: true,
        get: () => hostVolume,
      },
      playbackRate: {
        configurable: true,
        get: () => hostPlaybackRate,
      },
    });

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("M320-273v-414");

    hostPaused = true;
    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    expect(getOverlayBox()?.innerHTML).toContain("M640-200q-33 0");

    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("0%");
    expect(getOverlayBox()?.innerHTML).toContain("M671-177q-11 7-22 13");

    hostMuted = false;
    showActionOverlay("toggleMute", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("35%");
    expect(getOverlayBox()?.innerHTML).toContain("M760-481q0-83");

    showActionOverlay("volumeUp", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("35%");

    hostVolume = 0;
    showActionOverlay("volumeDown", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("0%");
    expect(getOverlayBox()?.innerHTML).toContain("M671-177q-11 7-22 13");

    showActionOverlay("speedUp", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("1.75x");

    hostPlaybackRate = 0.75;
    showActionOverlay("slowDown", video, "center", advancedSettings);
    expect(getOverlayBox()?.textContent).toBe("0.75x");
  });

  it("renders captions on with the track label, and captions off without one", () => {
    const video = makeVideo();

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, {
      captions: { enabled: true, label: "English" },
    });
    expect(getOverlayBox()?.textContent).toBe("Captions onEnglish");
    expect(getOverlayBox()?.innerHTML).toContain("M200-160q-33 0-56.5-23.5");

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, {
      captions: { enabled: true },
    });
    expect(getOverlayBox()?.textContent).toBe("Captions on");

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, {
      captions: { enabled: false },
    });
    expect(getOverlayBox()?.textContent).toBe("Captions off");
    expect(getOverlayBox()?.innerHTML).toContain("M791-57 687-160");
  });

  it("shows a track label as text, shortened when it is long", () => {
    const video = makeVideo();

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, {
      captions: { enabled: true, label: '<img src=x onerror="alert(1)">&amp;' },
    });
    expect(getOverlayBox()?.querySelector("img")).toBeNull();
    expect(getOverlayBox()?.textContent).toBe('Captions on<img src=x onerror="alert(1)">&amp;');

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, {
      captions: { enabled: true, label: "x".repeat(100) },
    });
    expect(getOverlayBox()?.textContent).toBe(`Captions on${"x".repeat(39)}…`);
  });

  it("renders nothing for captions when the media had no track to toggle", () => {
    const video = makeVideo();

    showActionOverlay("toggleCaptions", video, "center", advancedSettings, { captions: null });
    showActionOverlay("toggleCaptions", video, "center", advancedSettings);

    expect(getOverlayBox()).toBeNull();
  });

  it("does not render overlays for fullscreen or picture-in-picture toggles", () => {
    const video = makeVideo();

    showActionOverlay("toggleFullscreen", video, "center", advancedSettings);
    showActionOverlay("togglePip", video, "center", advancedSettings);

    expect(getOverlayBox()).toBeNull();
  });
});
