import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  actionSupportsOverlay,
  getSettings,
  resolveActionOverlaySettings,
  saveSettings,
} from "../src/storage.js";

const store: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...store })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

beforeEach(() => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  vi.clearAllMocks();
});

describe("getSettings", () => {
  it("returns defaults when storage is empty", async () => {
    const settings = await getSettings();
    expect(settings).toMatchObject(DEFAULT_SETTINGS);
    expect(settings.actions).toEqual(DEFAULT_SETTINGS.actions);
  });

  it("returns action-first structure with all actions", async () => {
    const settings = await getSettings();
    expect(settings.actions.togglePlayPause.keys).toEqual(["k"]);
    expect(settings.overlayVisibility).toBe("All");
    expect(settings.overlayPosition).toBe("center");
    expect(settings.actions.togglePlayPause.overlayVisible).toBeUndefined();
    expect(settings.actions.togglePlayPause.overlayPosition).toBeUndefined();
  });

  it("drops stale overlay overrides for actions that never show overlays", async () => {
    await saveSettings({
      actions: {
        toggleFullscreen: {
          keys: ["f"],
          overlayVisible: true,
          overlayPosition: "top",
        },
        seekToPercent50: {
          keys: ["5"],
          overlayVisible: true,
          overlayPosition: "bottom",
        },
      } as typeof DEFAULT_SETTINGS.actions,
    });

    const settings = await getSettings();
    expect(settings.actions.toggleFullscreen.overlayVisible).toBeUndefined();
    expect(settings.actions.toggleFullscreen.overlayPosition).toBeUndefined();
    expect(settings.actions.seekToPercent50.overlayVisible).toBeUndefined();
    expect(settings.actions.seekToPercent50.overlayPosition).toBeUndefined();
  });

  it("maps legacy nested global overlay booleans to overlayVisibility", async () => {
    store.globalSettings = {
      volumeStep: DEFAULT_SETTINGS.volumeStep,
      speedMin: DEFAULT_SETTINGS.speedMin,
      speedMax: DEFAULT_SETTINGS.speedMax,
      speedStep: DEFAULT_SETTINGS.speedStep,
      seekStepSmall: DEFAULT_SETTINGS.seekStepSmall,
      seekStepMedium: DEFAULT_SETTINGS.seekStepMedium,
      seekStepLarge: DEFAULT_SETTINGS.seekStepLarge,
      overlayPosition: DEFAULT_SETTINGS.overlayPosition,
      overlayVisibleDuration: DEFAULT_SETTINGS.overlayVisibleDuration,
      overlayFadeDuration: DEFAULT_SETTINGS.overlayFadeDuration,
      overlayVisibility: undefined,
      overlaysVisible: undefined,
      overlayVisible: false,
    };

    const settings = await getSettings();
    expect(settings.overlayVisibility).toBe("None");
  });
});

describe("saveSettings", () => {
  it("persists global settings changes", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.volumeStep = 0.1;
    modified.sumQuickSkips = false;
    await saveSettings(modified);
    const settings = await getSettings();
    expect(settings.volumeStep).toBe(0.1);
    expect(settings.sumQuickSkips).toBe(false);
  });

  it("persists action config changes for overlay-capable actions", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.actions.togglePlayPause.keys = ["k", " "];
    modified.actions.togglePlayPause.overlayPosition = "top";
    await saveSettings(modified);
    const settings = await getSettings();
    expect(settings.actions.togglePlayPause.keys).toEqual(["k", " "]);
    expect(settings.actions.togglePlayPause.overlayPosition).toBe("top");
  });

  it("deep-merges partial action overrides with defaults", async () => {
    await saveSettings({
      actions: {
        togglePlayPause: {
          keys: [" "],
        },
      } as typeof DEFAULT_SETTINGS.actions,
    });

    const settings = await getSettings();
    expect(settings.actions.togglePlayPause.keys).toEqual([" "]);
    expect(settings.actions.seekForwardSmall.overlayPosition).toBe("center-right");
    expect(settings.overlayVisibility).toBe("All");
  });
});

describe("overlay settings helpers", () => {
  it("marks fullscreen, pip, and percent seek actions as not supporting overlays", () => {
    expect(actionSupportsOverlay("toggleFullscreen")).toBe(false);
    expect(actionSupportsOverlay("togglePip")).toBe(false);
    expect(actionSupportsOverlay("seekToPercent50")).toBe(false);
    expect(actionSupportsOverlay("togglePlayPause")).toBe(true);
  });

  it("forces overlay visibility off when overlayVisibility is None", () => {
    const resolved = resolveActionOverlaySettings(
      "togglePlayPause",
      { keys: ["k"] },
      { ...DEFAULT_SETTINGS, overlayVisibility: "None" },
    );

    expect(resolved.overlayVisible).toBe(false);
    expect(resolved.overlayPosition).toBe(DEFAULT_SETTINGS.overlayPosition);
  });

  it("forces overlay visibility on when overlayVisibility is All", () => {
    const resolved = resolveActionOverlaySettings(
      "togglePlayPause",
      { keys: ["k"], overlayVisible: false },
      { ...DEFAULT_SETTINGS, overlayVisibility: "All" },
    );

    expect(resolved.overlayVisible).toBe(true);
    expect(resolved.overlayPosition).toBe(DEFAULT_SETTINGS.overlayPosition);
  });

  it("forces overlay visibility off for actions without overlays", () => {
    const resolved = resolveActionOverlaySettings(
      "toggleFullscreen",
      { keys: ["f"], overlayVisible: true, overlayPosition: "top" },
      DEFAULT_SETTINGS,
    );

    expect(resolved.overlayVisible).toBe(false);
    expect(resolved.overlayPosition).toBe(DEFAULT_SETTINGS.overlayPosition);
  });
});
