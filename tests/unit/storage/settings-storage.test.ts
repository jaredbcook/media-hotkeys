import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_QUICK_SETTINGS,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
} from "../../../src/storage.js";

const store: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(async () => ({ ...store })),
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

describe("settings storage", () => {
  it("returns grouped defaults when storage is empty", async () => {
    const settings = await getSettings();

    expect(browser.storage.sync.get).toHaveBeenCalledWith(null);
    expect(settings).toMatchObject(DEFAULT_SETTINGS);
    expect(settings.quickSettings).toEqual(DEFAULT_QUICK_SETTINGS);
    expect(settings.advancedSettings).toEqual(DEFAULT_ADVANCED_SETTINGS);
    expect(settings.quickSettings.actionKeyBindings).toEqual(
      DEFAULT_SETTINGS.quickSettings.actionKeyBindings,
    );
  });

  it("normalizes legacy flat settings into the grouped structure", async () => {
    Object.assign(store, {
      hotkeysEnabled: false,
      actions: {
        togglePlayPause: {
          keys: ["x"],
        },
      },
      showOverlays: false,
      debugLogging: true,
    });

    const settings = await getSettings();

    expect(settings.quickSettings.hotkeysEnabled).toBe(false);
    expect(settings.quickSettings.actionKeyBindings.togglePlayPause.keys).toEqual(["x"]);
    expect(settings.advancedSettings.showOverlays).toBe(false);
    expect(settings.advancedSettings.debugLogging).toBe(true);
  });

  it("persists advanced settings changes", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.advancedSettings.volumeStep = 0.1;
    modified.advancedSettings.sumQuickSkips = false;
    modified.advancedSettings.debugLogging = false;
    modified.quickSettings.hotkeysEnabled = false;
    await saveSettings(modified);

    const settings = await getSettings();
    expect(settings.advancedSettings.volumeStep).toBe(0.1);
    expect(settings.advancedSettings.sumQuickSkips).toBe(false);
    expect(settings.advancedSettings.debugLogging).toBe(false);
    expect(settings.quickSettings.hotkeysEnabled).toBe(false);
  });

  it("persists grouped settings without leaking grouped objects into advanced settings", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.advancedSettings.debugLogging = true;

    await saveSettings(modified);

    expect(store.advancedSettings).toEqual({
      ...DEFAULT_ADVANCED_SETTINGS,
      debugLogging: true,
    });
  });

  it("persists quick action binding changes", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.quickSettings.actionKeyBindings.togglePlayPause.keys = ["k", " "];
    await saveSettings(modified);

    const settings = await getSettings();
    expect(settings.quickSettings.actionKeyBindings.togglePlayPause.keys).toEqual(["k", " "]);
  });

  it("deep merges partial action key binding overrides with defaults", async () => {
    await saveSettings({
      quickSettings: {
        actionKeyBindings: {
          togglePlayPause: {
            keys: [" "],
          },
        },
      },
    });

    const settings = await getSettings();
    expect(settings.quickSettings.actionKeyBindings.togglePlayPause.keys).toEqual([" "]);
    expect(settings.quickSettings.actionKeyBindings.seekForwardSmall).toEqual({
      keys: ["ArrowRight"],
    });
    expect(settings.advancedSettings.showOverlays).toBe(true);
  });

  it("writes grouped settings when saving legacy flat updates", async () => {
    await saveSettings({
      hotkeysEnabled: false,
      showOverlays: false,
      actions: {
        togglePlayPause: {
          keys: ["x"],
        },
      },
    });

    expect(store.quickSettings).toMatchObject({
      hotkeysEnabled: false,
      actionKeyBindings: {
        togglePlayPause: {
          keys: ["x"],
        },
      },
    });
    expect(store.advancedSettings).toMatchObject({
      showOverlays: false,
    });
  });
});
