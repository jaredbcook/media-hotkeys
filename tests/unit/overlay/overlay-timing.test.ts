import { describe, expect, it, vi } from "vitest";
import { getOverlayElement, makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS, type AdvancedSettings } from "../../../src/storage.js";

const advancedSettings: AdvancedSettings = DEFAULT_ADVANCED_SETTINGS;

describe("overlay timing and lifecycle", () => {
  it("creates the overlay element on first call and shows it as flex", () => {
    const video = makeVideo();

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);

    const overlay = getOverlayElement();
    expect(overlay).not.toBeNull();
    expect(overlay?.style.display).toBe("flex");
  });

  it("hides the overlay after the configured duration elapses", () => {
    const video = makeVideo();

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    const overlay = getOverlayElement()!;
    expect(overlay.style.display).toBe("flex");

    vi.advanceTimersByTime(
      advancedSettings.overlayVisibleDuration + advancedSettings.overlayFadeDuration + 150,
    );

    expect(overlay.style.display).toBe("none");
  });

  it("reuses the same element across calls", () => {
    const video = makeVideo();

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    showActionOverlay("toggleMute", video, "center", advancedSettings);

    expect(document.querySelectorAll("#media-shortcuts-overlay")).toHaveLength(1);
  });

  it("uses custom global settings for timing", () => {
    const video = makeVideo();
    const customSettings: AdvancedSettings = {
      ...advancedSettings,
      overlayVisibleDuration: 1000,
      overlayFadeDuration: 500,
    };

    showActionOverlay("togglePlayPause", video, "center", customSettings);
    const overlay = getOverlayElement()!;

    vi.advanceTimersByTime(800);
    expect(overlay.style.display).toBe("flex");

    vi.advanceTimersByTime(1000 + 500 + 50);
    expect(overlay.style.display).toBe("none");
  });

  it("animates the first forward skip with a right slide", () => {
    const video = makeVideo();

    showActionOverlay("seekForwardSmall", video, "center-right", advancedSettings, {
      animateSkipDirection: "forward",
    });

    const overlay = getOverlayElement()!;
    expect(overlay.style.animation).toContain("media-shortcuts-skip-slide");
    expect(overlay.style.getPropertyValue("--media-shortcuts-slide-from-x")).toBe("-20%");
  });

  it("does not animate when no skip animation direction is provided", () => {
    const video = makeVideo();

    showActionOverlay("seekBackwardSmall", video, "center-left", advancedSettings);

    expect(getOverlayElement()?.style.animation).toBe("none");
  });
});
