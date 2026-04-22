import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_QUICK_SETTINGS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_SETTINGS,
  findMatchingDisabledUrlPattern,
  findMatchingSitePolicy,
  getSettings,
  getDisabledSitePrefillForUrl,
  getSitePolicySectionPatternForUrl,
  isUrlDisabledBySiteSettings,
  normalizeDisabledUrlPattern,
  normalizeDisabledUrlPatterns,
  normalizeSitePolicies,
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
    expect(settings.siteSettings).toEqual(DEFAULT_SITE_SETTINGS);
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

  it("skips storage writes when a save does not change normalized settings", async () => {
    await saveSettings(DEFAULT_SETTINGS);

    expect(browser.storage.sync.set).not.toHaveBeenCalled();
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

  it("normalizes disabled URL patterns and drops invalid entries", async () => {
    await saveSettings({
      siteSettings: {
        disabledUrlPatterns: [
          "https://www.youtube.com/shorts?feature=share#clip",
          "youtube.com/shorts/",
          "not a site",
        ],
      },
    });

    const settings = await getSettings();
    expect(settings.siteSettings.disabledUrlPatterns).toEqual(["youtube.com/shorts"]);
    expect(settings.siteSettings.sitePolicies).toEqual([
      { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ]);
  });

  it("normalizes site policies and derives legacy disabled URL patterns", async () => {
    await saveSettings({
      siteSettings: {
        sitePolicies: [
          {
            pattern: "https://www.youtube.com/shorts?feature=share#clip",
            policy: "enabled",
            embedsPolicy: "ignore",
          },
          { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
          { pattern: "not a site", policy: "disabled", embedsPolicy: "inherit" },
        ],
      },
    });

    const settings = await getSettings();
    expect(settings.siteSettings.sitePolicies).toEqual([
      { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "youtube.com/shorts", policy: "enabled", embedsPolicy: "ignore" },
    ]);
    expect(settings.siteSettings.disabledUrlPatterns).toEqual(["vimeo.com"]);
  });

  it("matches disabled URL patterns against top-level URLs", () => {
    const siteSettings = {
      sitePolicies: [
        { pattern: "youtube.com/shorts", policy: "disabled" as const, embedsPolicy: "inherit" },
        { pattern: "vimeo.com", policy: "disabled" as const, embedsPolicy: "inherit" },
      ],
      disabledUrlPatterns: ["youtube.com/shorts", "vimeo.com"],
    };

    expect(isUrlDisabledBySiteSettings("https://www.youtube.com/shorts/abc", siteSettings)).toBe(
      true,
    );
    expect(isUrlDisabledBySiteSettings("https://www.youtube.com/watch?v=1", siteSettings)).toBe(
      false,
    );
    expect(isUrlDisabledBySiteSettings("https://player.vimeo.com/video/1", siteSettings)).toBe(
      true,
    );
  });

  it("uses more specific enabled site policies over broader disabled policies", () => {
    const siteSettings = {
      sitePolicies: [
        { pattern: "youtube.com", policy: "disabled" as const, embedsPolicy: "inherit" },
        { pattern: "youtube.com/shorts", policy: "enabled" as const, embedsPolicy: "inherit" },
      ],
      disabledUrlPatterns: ["youtube.com"],
    };

    expect(findMatchingSitePolicy("https://www.youtube.com/shorts/abc", siteSettings)?.policy).toBe(
      "enabled",
    );
    expect(isUrlDisabledBySiteSettings("https://www.youtube.com/shorts/abc", siteSettings)).toBe(
      false,
    );
    expect(isUrlDisabledBySiteSettings("https://www.youtube.com/watch?v=1", siteSettings)).toBe(
      true,
    );
  });

  it("normalizes missing and invalid embed policies to inherit", () => {
    expect(
      normalizeSitePolicies([
        { pattern: "youtube.com", policy: "disabled" as const },
        {
          pattern: "vimeo.com",
          policy: "disabled" as const,
          embedsPolicy: "unsupported" as "inherit",
        },
      ]),
    ).toEqual([
      { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ]);
  });

  it("sorts normalized site policies alphabetically", () => {
    expect(
      normalizeSitePolicies([
        { pattern: "youtube.com/shorts", policy: "enabled", embedsPolicy: "inherit" },
        { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
        { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      ]),
    ).toEqual([
      { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "youtube.com/shorts", policy: "enabled", embedsPolicy: "inherit" },
    ]);
  });

  it("normalizes URL-ish disabled site entries", () => {
    expect(normalizeDisabledUrlPattern("https://www.bbc.co.uk/news?x=1#top")).toBe(
      "bbc.co.uk/news",
    );
    expect(normalizeDisabledUrlPattern("youtube.com/shorts/")).toBe("youtube.com/shorts");
    expect(normalizeDisabledUrlPattern("not a site")).toBeNull();
    expect(normalizeDisabledUrlPatterns(["youtube.com", "https://www.youtube.com/"])).toEqual([
      "youtube.com",
    ]);
  });

  it("finds a matching disabled pattern and prefill domain for a URL", () => {
    expect(
      findMatchingDisabledUrlPattern("https://www.youtube.com/shorts/abc", ["youtube.com/shorts"]),
    ).toBe("youtube.com/shorts");
    expect(getDisabledSitePrefillForUrl("https://www.youtube.com/shorts/abc")).toBe("youtube.com");
    expect(getSitePolicySectionPatternForUrl("https://www.youtube.com/shorts/abc")).toBe(
      "youtube.com/shorts",
    );
    expect(getDisabledSitePrefillForUrl("chrome://extensions")).toBeNull();
  });

  it("deduplicates site policies by topmost rule", () => {
    expect(
      normalizeSitePolicies([
        { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
        { pattern: "https://www.youtube.com/", policy: "enabled", embedsPolicy: "ignore" },
      ]),
    ).toEqual([{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }]);
  });
});
