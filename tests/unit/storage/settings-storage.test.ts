import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_QUICK_SETTINGS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_SETTINGS,
  findMatchingSitePolicy,
  getSettings,
  getDisabledSitePrefillForUrl,
  getSitePolicySectionPatternForUrl,
  isUrlDisabledBySiteSettings,
  normalizeDisabledUrlPattern,
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

  it("ignores unknown top-level and nested keys in storage and drops nested extras on save", async () => {
    Object.assign(store, {
      unknownTopLevelKey: "ignored",
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
        extraSiteKey: ["youtube.com"],
      },
    });

    const settings = await getSettings();

    expect(settings).toEqual({
      quickSettings: DEFAULT_QUICK_SETTINGS,
      advancedSettings: DEFAULT_ADVANCED_SETTINGS,
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
      },
    });

    await saveSettings({
      siteSettings: {
        sitePolicies: [{ pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" }],
      },
    });

    expect(store.siteSettings).toEqual({
      sitePolicies: [{ pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" }],
    });
  });

  it("keeps a skip of 600 seconds through save and load", async () => {
    const modified = structuredClone(DEFAULT_SETTINGS);
    modified.advancedSettings.seekStepLarge = 600;
    await saveSettings(modified);

    const settings = await getSettings();

    expect(settings.advancedSettings.seekStepLarge).toBe(600);
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

  it("preserves existing custom action key bindings when saving a partial binding update", async () => {
    await saveSettings({
      quickSettings: {
        actionKeyBindings: {
          togglePlayPause: { keys: [" "] },
        },
      },
    });

    await saveSettings({
      quickSettings: {
        actionKeyBindings: {
          toggleMute: { keys: ["u"] },
        },
      },
    });

    const settings = await getSettings();
    expect(settings.quickSettings.actionKeyBindings.togglePlayPause.keys).toEqual([" "]);
    expect(settings.quickSettings.actionKeyBindings.toggleMute.keys).toEqual(["u"]);
  });

  it("does not give a newly added default key to an action when the user already bound it", async () => {
    Object.assign(store, {
      quickSettings: {
        actionKeyBindings: {
          restart: { keys: ["T"] },
        },
      },
    });

    const settings = await getSettings();
    expect(settings.quickSettings.actionKeyBindings.restart.keys).toEqual(["T"]);
    expect(settings.quickSettings.actionKeyBindings.toggleTheater.keys).toEqual([]);
    expect(settings.quickSettings.actionKeyBindings.togglePip.keys).toEqual(["i"]);
  });

  it("normalizes site policies and drops invalid entries", async () => {
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
  });

  it("matches disabled site policies against top-level URLs", () => {
    const siteSettings = {
      sitePolicies: [
        {
          pattern: "youtube.com/shorts",
          policy: "disabled" as const,
          embedsPolicy: "inherit" as const,
        },
        { pattern: "vimeo.com", policy: "disabled" as const, embedsPolicy: "inherit" as const },
      ],
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
        { pattern: "youtube.com", policy: "disabled" as const, embedsPolicy: "inherit" as const },
        {
          pattern: "youtube.com/shorts",
          policy: "enabled" as const,
          embedsPolicy: "inherit" as const,
        },
      ],
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
  });

  it("finds a matching site policy and prefill domain for a URL", () => {
    expect(
      findMatchingSitePolicy("https://www.youtube.com/shorts/abc", {
        sitePolicies: [
          { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
        ],
      })?.pattern,
    ).toBe("youtube.com/shorts");
    expect(getDisabledSitePrefillForUrl("https://www.youtube.com/shorts/abc")).toBe("youtube.com");
    expect(getSitePolicySectionPatternForUrl("https://www.youtube.com/shorts/abc")).toBe(
      "youtube.com/shorts",
    );
    expect(getSitePolicySectionPatternForUrl("https://www.youtube.com/shorts/")).toBe(
      "youtube.com/shorts",
    );
    expect(getSitePolicySectionPatternForUrl("https://www.youtube.com/watch?v=abc")).toBe(
      "youtube.com",
    );
    expect(getSitePolicySectionPatternForUrl("https://www.youtube.com/")).toBe("youtube.com");
    expect(getDisabledSitePrefillForUrl("chrome://extensions")).toBeNull();
  });

  it("keeps sites on shared hosting platforms separate", () => {
    expect(normalizeDisabledUrlPattern("https://alice.github.io/blog/post")).toBe(
      "alice.github.io/blog/post",
    );
    expect(normalizeDisabledUrlPattern("www.alice.github.io")).toBe("alice.github.io");
    expect(normalizeDisabledUrlPattern("app.b.vercel.app")).toBe("b.vercel.app");
    expect(getDisabledSitePrefillForUrl("https://alice.github.io/blog/")).toBe("alice.github.io");
    expect(getSitePolicySectionPatternForUrl("https://alice.github.io/blog/post")).toBe(
      "alice.github.io/blog",
    );

    const siteSettings = {
      sitePolicies: [
        {
          pattern: "alice.github.io",
          policy: "disabled" as const,
          embedsPolicy: "inherit" as const,
        },
      ],
    };
    expect(isUrlDisabledBySiteSettings("https://alice.github.io/video", siteSettings)).toBe(true);
    expect(isUrlDisabledBySiteSettings("https://bob.github.io/video", siteSettings)).toBe(false);
    expect(findMatchingSitePolicy("https://bob.github.io/", siteSettings)).toBeUndefined();
  });

  it("drops rules for a whole shared hosting platform", async () => {
    expect(normalizeDisabledUrlPattern("github.io")).toBeNull();
    expect(normalizeDisabledUrlPattern("https://pages.dev/")).toBeNull();

    await saveSettings({
      siteSettings: {
        sitePolicies: [
          { pattern: "github.io", policy: "disabled", embedsPolicy: "inherit" },
          { pattern: "alice.github.io", policy: "disabled", embedsPolicy: "inherit" },
        ],
      },
    });

    const settings = await getSettings();
    expect(settings.siteSettings.sitePolicies).toEqual([
      { pattern: "alice.github.io", policy: "disabled", embedsPolicy: "inherit" },
    ]);
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
