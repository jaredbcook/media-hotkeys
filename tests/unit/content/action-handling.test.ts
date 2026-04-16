import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, resetContentTestState, showActionOverlayMock } from "./helpers.js";
import { handleAction, setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

describe("media action handling", () => {
  it("logs handled actions when debug logging is enabled", () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const video = makeVideo();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.debugLogging = true;
    setSettingsForTests(settings);

    handleAction("toggleMute", video);

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[Media Hotkeys][debug] Tracked media interaction",
      expect.objectContaining({
        event: "action:toggleMute",
        tagName: "VIDEO",
      }),
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[Media Hotkeys][debug] Handled media action",
      expect.objectContaining({
        action: "toggleMute",
        tagName: "VIDEO",
      }),
    );
  });

  it("does not log handled actions when debug logging is disabled", () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const video = makeVideo();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.debugLogging = false;
    setSettingsForTests(settings);

    handleAction("toggleMute", video);

    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("toggles play and pauses blocked playback without surfacing errors", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    handleAction("togglePlayPause", video);
    expect(playSpy).toHaveBeenCalled();

    const rejection = new DOMException("Playback blocked", "NotAllowedError");
    playSpy.mockRejectedValueOnce(rejection);
    handleAction("togglePlayPause", video);
    await Promise.resolve();

    playSpy.mockReturnValueOnce({
      then: (resolve?: () => void, reject?: (error: DOMException) => void) => {
        reject?.(new DOMException("Playback blocked", "NotAllowedError"));
        resolve?.();
      },
    } as unknown as Promise<void>);
    handleAction("togglePlayPause", video);
    await Promise.resolve();

    playSpy.mockRejectedValueOnce({ name: "NotAllowedError" });
    handleAction("togglePlayPause", video);
    await Promise.resolve();
  });

  it("prefers a custom element host play() method for shadow-root media", async () => {
    const host = document.createElement("custom-player");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/test.mp4");
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: true,
      writable: true,
    });
    shadowRoot.appendChild(video);
    document.body.appendChild(host);

    const hostPlay = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(host, "play", {
      configurable: true,
      value: hostPlay,
      writable: true,
    });
    const mediaPlaySpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    handleAction("togglePlayPause", video);
    await Promise.resolve();

    expect(hostPlay).toHaveBeenCalledOnce();
    expect(mediaPlaySpy).not.toHaveBeenCalled();
  });

  it("clicks a shadow play button before falling back to media.play()", async () => {
    const host = document.createElement("custom-player");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/test.mp4");
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: true,
      writable: true,
    });
    const playButton = document.createElement("button");
    playButton.setAttribute("aria-label", "Play media");
    Object.defineProperty(playButton, "innerText", {
      configurable: true,
      value: "Play media",
      writable: true,
    });
    shadowRoot.appendChild(playButton);
    shadowRoot.appendChild(video);
    document.body.appendChild(host);

    const clickSpy = vi.spyOn(playButton, "click");
    const mediaPlaySpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    handleAction("togglePlayPause", video);
    await Promise.resolve();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(mediaPlaySpy).toHaveBeenCalledOnce();
  });

  it("toggles mute and restores the configured volume step from zero volume", () => {
    const video = makeVideo();
    video.muted = false;

    handleAction("toggleMute", video);
    expect(video.muted).toBe(true);

    handleAction("toggleMute", video);
    expect(video.muted).toBe(false);

    video.volume = 0;
    handleAction("toggleMute", video);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(DEFAULT_SETTINGS.advancedSettings.volumeStep);
  });

  it("restarts media and shows a zero timestamp overlay", () => {
    const video = makeVideo({ currentTime: 42, duration: 100 } as Partial<HTMLVideoElement>);

    handleAction("restart", video);

    expect(video.currentTime).toBe(0);
    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "restart",
      video,
      "center",
      expect.anything(),
      { timestampSeconds: 0, jumpDirection: "backward" },
    );
  });

  it("adjusts volume up and down with the expected mute edge cases", () => {
    const video = makeVideo();
    video.volume = 0.98;

    handleAction("volumeUp", video);
    expect(video.volume).toBeCloseTo(1.0);

    handleAction("volumeUp", video);
    expect(video.volume).toBe(1);

    video.volume = 0.8;
    video.muted = true;
    handleAction("volumeUp", video);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(DEFAULT_SETTINGS.advancedSettings.volumeStep);

    handleAction("toggleMute", video);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(DEFAULT_SETTINGS.advancedSettings.volumeStep);

    video.volume = 0.02;
    video.muted = false;
    handleAction("volumeDown", video);
    expect(video.volume).toBeCloseTo(0);

    handleAction("volumeDown", video);
    expect(video.volume).toBe(0);

    video.volume = 0.8;
    video.muted = true;
    handleAction("volumeDown", video);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0);
  });

  it("seeks with configured step sizes", () => {
    const video = makeVideo();
    video.currentTime = 10;

    handleAction("seekForwardSmall", video);
    expect(video.currentTime).toBe(15);

    handleAction("seekForwardMedium", video);
    expect(video.currentTime).toBe(25);

    handleAction("seekBackwardLarge", video);
    expect(video.currentTime).toBe(-5);
  });

  it("adjusts playback speed within configured bounds", () => {
    const video = makeVideo();
    video.playbackRate = 3.75;

    handleAction("speedUp", video);
    expect(video.playbackRate).toBeCloseTo(4.0);

    handleAction("speedUp", video);
    expect(video.playbackRate).toBe(4);

    video.playbackRate = 0.5;
    handleAction("slowDown", video);
    expect(video.playbackRate).toBeCloseTo(0.25);

    handleAction("slowDown", video);
    expect(video.playbackRate).toBe(0.25);
  });

  it("seeks to a percentage of duration and reports overlay direction", () => {
    const video = makeVideo({ currentTime: 25, duration: 100 } as Partial<HTMLVideoElement>);

    handleAction("seekToPercent50", video);

    expect(video.currentTime).toBe(50);
    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "seekToPercent50",
      video,
      "center",
      expect.anything(),
      { timestampSeconds: 50, jumpDirection: "forward" },
    );

    video.currentTime = 75;
    handleAction("seekToPercent50", video);

    expect(showActionOverlayMock).toHaveBeenLastCalledWith(
      "seekToPercent50",
      video,
      "center",
      expect.anything(),
      { timestampSeconds: 50, jumpDirection: "backward" },
    );
  });

  it("uses the global overlay position for non-skip overlays", () => {
    const video = makeVideo();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.overlayPosition = "top-left";
    setSettingsForTests(settings);

    handleAction("toggleMute", video);

    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "toggleMute",
      video,
      "top-left",
      expect.anything(),
      {},
    );
  });

  it("shows an overlay confirmation when overlays are toggled off", () => {
    const video = makeVideo();

    handleAction("toggleOverlays", video);

    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "toggleOverlays",
      video,
      "center",
      expect.anything(),
      { overlayEnabled: false },
    );
  });

  it("requests fullscreen on an existing player container when available", () => {
    const container = document.createElement("div");
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/test.mp4");
    container.appendChild(video);
    document.body.appendChild(container);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      bottom: 210,
      height: 200,
      left: 10,
      right: 310,
      top: 10,
      width: 300,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      bottom: 215,
      height: 205,
      left: 8,
      right: 312,
      top: 10,
      width: 304,
      x: 8,
      y: 10,
      toJSON: () => ({}),
    });

    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLDivElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreenMock,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });

    handleAction("toggleFullscreen", video);

    expect(video.parentElement).toBe(container);
    expect(document.querySelector('[data-media-hotkeys-fullscreen-wrapper="true"]')).toBeNull();
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(requestFullscreenMock.mock.instances[0]).toBe(container);
  });

  it("wraps bare videos before requesting fullscreen", () => {
    const video = makeVideo();
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLDivElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreenMock,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });

    handleAction("toggleFullscreen", video);

    const wrapper = video.parentElement as HTMLDivElement | null;
    expect(wrapper?.dataset.mediaHotkeysFullscreenWrapper).toBe("true");
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(requestFullscreenMock.mock.instances[0]).toBe(wrapper);
  });

  it("restores the original DOM structure after fullscreen exits", () => {
    const video = makeVideo();
    let fullscreenElement: Element | null = null;

    Object.defineProperty(HTMLDivElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });

    handleAction("toggleFullscreen", video);
    const wrapper = video.parentElement as HTMLDivElement | null;
    expect(wrapper?.dataset.mediaHotkeysFullscreenWrapper).toBe("true");

    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));

    expect(video.parentElement).toBe(document.body);
    expect(document.querySelector('[data-media-hotkeys-fullscreen-wrapper="true"]')).toBeNull();
  });
});
