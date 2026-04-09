import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));
import {
  DEFAULT_ADVANCED_SETTINGS,
  actionSupportsOverlay,
  resolveActionOverlaySettings,
} from "../../../src/storage.js";

describe("overlay policy helpers", () => {
  it("marks fullscreen and picture-in-picture actions as not supporting overlays", () => {
    expect(actionSupportsOverlay("toggleFullscreen")).toBe(false);
    expect(actionSupportsOverlay("togglePip")).toBe(false);
    expect(actionSupportsOverlay("seekToPercent50")).toBe(true);
    expect(actionSupportsOverlay("togglePlayPause")).toBe(true);
  });

  it("turns overlays off when showOverlays is false", () => {
    const resolved = resolveActionOverlaySettings(
      "togglePlayPause",
      { keys: ["k"] },
      { ...DEFAULT_ADVANCED_SETTINGS, showOverlays: false },
    );

    expect(resolved.overlayVisible).toBe(false);
    expect(resolved.overlayPosition).toBe(DEFAULT_ADVANCED_SETTINGS.overlayPosition);
  });

  it("uses left and right positions for skip actions when configured", () => {
    const resolved = resolveActionOverlaySettings(
      "seekForwardSmall",
      { keys: ["ArrowRight"] },
      { ...DEFAULT_ADVANCED_SETTINGS, skipOverlayPosition: "left / right" },
    );

    expect(resolved.overlayVisible).toBe(true);
    expect(resolved.overlayPosition).toBe("center-right");
  });

  it("uses the advanced overlay position for skip actions when inheriting", () => {
    const resolved = resolveActionOverlaySettings(
      "seekBackwardSmall",
      { keys: ["ArrowLeft"] },
      {
        ...DEFAULT_ADVANCED_SETTINGS,
        overlayPosition: "bottom",
        skipOverlayPosition: "same as others",
      },
    );

    expect(resolved.overlayVisible).toBe(true);
    expect(resolved.overlayPosition).toBe("bottom");
  });

  it("forces overlay visibility off for actions without overlays", () => {
    const resolved = resolveActionOverlaySettings(
      "toggleFullscreen",
      { keys: ["f"] },
      DEFAULT_ADVANCED_SETTINGS,
    );

    expect(resolved.overlayVisible).toBe(false);
    expect(resolved.overlayPosition).toBe(DEFAULT_ADVANCED_SETTINGS.overlayPosition);
  });
});
