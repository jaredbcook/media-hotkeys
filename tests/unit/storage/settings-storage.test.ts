import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  DEFAULT_ADVANCED_SETTINGS,
  DEFAULT_QUICK_SETTINGS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_SETTINGS,
  findMatchingSitePolicy,
  getSettings,
  isUrlDisabledBySiteSettings,
  saveSettings,
} from "../../../src/storage.js";
import {
  getDisabledSitePrefillForUrl,
  getSitePolicySectionPatternForUrl,
  normalizeDisabledUrlPattern,
  normalizeSitePolicies,
} from "../../../src/site-patterns.js";

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

  it("normalizes site policies entered by the user and drops invalid entries", async () => {
    await saveSettings({
      siteSettings: {
        sitePolicies: normalizeSitePolicies([
          {
            pattern: "https://www.youtube.com/shorts?feature=share#clip",
            policy: "enabled",
            embedsPolicy: "ignore",
          },
          { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
          { pattern: "not a site", policy: "disabled", embedsPolicy: "inherit" },
        ]),
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

  it("saves the host as typed, except for a leading www.", () => {
    expect(normalizeDisabledUrlPattern("music.youtube.com")).toBe("music.youtube.com");
    expect(normalizeDisabledUrlPattern("https://Music.YouTube.com/browse?x=1")).toBe(
      "music.youtube.com/browse",
    );
    expect(normalizeDisabledUrlPattern("www.example.com")).toBe("example.com");
    expect(normalizeDisabledUrlPattern("https://www.example.com/a/")).toBe("example.com/a");
    expect(normalizeDisabledUrlPattern("m.youtube.com")).toBe("m.youtube.com");
    expect(normalizeDisabledUrlPattern("www.docs.google.com")).toBe("docs.google.com");
    expect(normalizeDisabledUrlPattern("www.www.example.com")).toBe("example.com");
    expect(normalizeDisabledUrlPattern("www.localhost")).toBe("www.localhost");
    expect(normalizeDisabledUrlPattern("a.b.c.bbc.co.uk")).toBe("a.b.c.bbc.co.uk");
    expect(normalizeDisabledUrlPattern("example.com.")).toBe("example.com");
    expect(normalizeDisabledUrlPattern("http://localhost:3000/video")).toBe("localhost/video");
    expect(normalizeDisabledUrlPattern("http://192.168.1.10/")).toBe("192.168.1.10");
  });

  it("leaves a normalized rule unchanged when it is normalized again", () => {
    for (const entry of [
      "www.www.example.com/a",
      "www.co.uk",
      "m.youtube.com",
      "http://localhost:3000/v",
      "www.localhost",
      "www.alice.github.io",
    ]) {
      const once = normalizeDisabledUrlPattern(entry);
      expect(once, entry).not.toBeNull();
      expect(normalizeDisabledUrlPattern(once!), entry).toBe(once);
    }
  });

  it("refuses a bare public suffix or a single label but accepts a private suffix", () => {
    expect(normalizeDisabledUrlPattern("com")).toBeNull();
    expect(normalizeDisabledUrlPattern("co.uk")).toBeNull();
    expect(normalizeDisabledUrlPattern("www.co.uk")).toBe("www.co.uk");
    expect(normalizeDisabledUrlPattern("intranet")).toBeNull();
    expect(normalizeDisabledUrlPattern("github.io")).toBe("github.io");
    expect(normalizeDisabledUrlPattern("https://pages.dev/")).toBe("pages.dev");
    expect(normalizeDisabledUrlPattern("www.github.io")).toBe("github.io");
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
    expect(getDisabledSitePrefillForUrl("https://music.youtube.com/watch?v=1")).toBe(
      "music.youtube.com",
    );
    expect(getDisabledSitePrefillForUrl("https://www.alice.github.io/")).toBe("alice.github.io");
    expect(getDisabledSitePrefillForUrl("http://localhost:3000/")).toBe("localhost");
    expect(getSitePolicySectionPatternForUrl("https://music.youtube.com/browse/abc")).toBe(
      "music.youtube.com/browse",
    );
    expect(getSitePolicySectionPatternForUrl("https://m.youtube.com/watch?v=1")).toBe(
      "m.youtube.com",
    );
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
    expect(normalizeDisabledUrlPattern("app.b.vercel.app")).toBe("app.b.vercel.app");
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

  it("accepts a rule for a whole shared hosting platform", async () => {
    await saveSettings({
      siteSettings: {
        sitePolicies: normalizeSitePolicies([
          { pattern: "github.io", policy: "disabled", embedsPolicy: "inherit" },
          { pattern: "alice.github.io", policy: "enabled", embedsPolicy: "inherit" },
        ]),
      },
    });

    const { siteSettings } = await getSettings();
    expect(siteSettings.sitePolicies).toEqual([
      { pattern: "alice.github.io", policy: "enabled", embedsPolicy: "inherit" },
      { pattern: "github.io", policy: "disabled", embedsPolicy: "inherit" },
    ]);
    expect(isUrlDisabledBySiteSettings("https://bob.github.io/", siteSettings)).toBe(true);
    expect(isUrlDisabledBySiteSettings("https://alice.github.io/", siteSettings)).toBe(false);
  });

  it("deduplicates site policies by topmost rule", () => {
    expect(
      normalizeSitePolicies([
        { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
        { pattern: "https://www.youtube.com/", policy: "enabled", embedsPolicy: "ignore" },
      ]),
    ).toEqual([{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }]);
  });

  describe("matching saved rules without the public suffix list", () => {
    const rule = (pattern: string, policy: "disabled" | "enabled" = "disabled") => ({
      pattern,
      policy,
      embedsPolicy: "inherit" as const,
    });
    const match = (url: string, ...patterns: string[]) =>
      findMatchingSitePolicy(url, { sitePolicies: patterns.map((pattern) => rule(pattern)) })
        ?.pattern;

    it("matches the saved host and every subdomain under it", () => {
      expect(match("https://youtube.com/", "youtube.com")).toBe("youtube.com");
      expect(match("https://www.youtube.com/watch?v=1", "youtube.com")).toBe("youtube.com");
      expect(match("https://m.www.YouTube.com./", "youtube.com")).toBe("youtube.com");
      expect(match("https://notyoutube.com/", "youtube.com")).toBeUndefined();
      expect(match("https://youtube.com.evil.example/", "youtube.com")).toBeUndefined();
    });

    it("matches multi-part public suffixes like co.uk", () => {
      expect(match("https://www.bbc.co.uk/news/1", "bbc.co.uk/news")).toBe("bbc.co.uk/news");
      expect(match("https://www.bbc.co.uk/sport", "bbc.co.uk/news")).toBeUndefined();
      expect(match("https://itv.co.uk/", "bbc.co.uk")).toBeUndefined();
    });

    it("lets a rule for one subdomain leave the rest of the site alone", () => {
      expect(match("https://music.youtube.com/", "music.youtube.com")).toBe("music.youtube.com");
      expect(match("https://www.music.youtube.com/", "music.youtube.com")).toBe(
        "music.youtube.com",
      );
      expect(match("https://youtube.com/", "music.youtube.com")).toBeUndefined();
      expect(match("https://www.youtube.com/", "music.youtube.com")).toBeUndefined();
      expect(match("https://m.youtube.com/", "music.youtube.com")).toBeUndefined();
      expect(match("https://notmusic.youtube.com/", "music.youtube.com")).toBeUndefined();
      expect(match("https://badmusic.youtube.com.evil.example/", "music.youtube.com")).toBe(
        undefined,
      );
    });

    it("keeps shared hosting tenants apart", () => {
      expect(match("https://www.alice.github.io/", "alice.github.io")).toBe("alice.github.io");
      expect(match("https://bob.github.io/", "alice.github.io")).toBeUndefined();
      expect(match("https://app.b.vercel.app/", "b.vercel.app")).toBe("b.vercel.app");
    });

    it("matches localhost and IP addresses exactly", () => {
      expect(match("http://www.localhost/", "www.localhost")).toBe("www.localhost");
      expect(match("http://www.localhost/", "localhost")).toBeUndefined();
      expect(match("http://localhost:3000/video", "localhost")).toBe("localhost");
      expect(match("http://dev.localhost/", "localhost")).toBeUndefined();
      expect(match("http://192.168.1.10/", "192.168.1.10")).toBe("192.168.1.10");
      expect(match("http://192.168.1.10/", "168.1.10")).toBeUndefined();
    });

    it("prefers the more specific host when saved hosts nest", () => {
      expect(match("https://music.youtube.com/", "youtube.com", "music.youtube.com")).toBe(
        "music.youtube.com",
      );
      expect(match("https://a.music.youtube.com/", "youtube.com", "music.youtube.com")).toBe(
        "music.youtube.com",
      );
      expect(match("https://www.youtube.com/", "youtube.com", "music.youtube.com")).toBe(
        "youtube.com",
      );
      expect(match("https://music.youtube.com/", "music.youtube.com", "youtube.com")).toBe(
        "music.youtube.com",
      );
      // The host decides before the path does.
      expect(
        match("https://music.youtube.com/shorts/1", "youtube.com/shorts", "music.youtube.com"),
      ).toBe("music.youtube.com");
      // At the same host, the longer path wins.
      expect(
        match(
          "https://music.youtube.com/shorts/1",
          "music.youtube.com",
          "music.youtube.com/shorts",
        ),
      ).toBe("music.youtube.com/shorts");
    });

    it("prefers the longer host when saved hosts nest across a public suffix", () => {
      expect(
        match("https://bucket.s3.amazonaws.com/video", "amazonaws.com", "bucket.s3.amazonaws.com"),
      ).toBe("bucket.s3.amazonaws.com");
      expect(
        match(
          "https://bucket.s3.amazonaws.com/video",
          "amazonaws.com/video",
          "bucket.s3.amazonaws.com",
        ),
      ).toBe("bucket.s3.amazonaws.com");
    });

    it("keeps the case of paths, as URLs do", async () => {
      expect(match("https://example.com/Video/1", "example.com/Video")).toBe("example.com/Video");
      expect(match("https://example.com/video/1", "example.com/Video")).toBeUndefined();
      expect(match("https://example.com/caf%C3%A9", "example.com/caf%C3%A9")).toBe(
        "example.com/caf%C3%A9",
      );

      await saveSettings({
        siteSettings: {
          sitePolicies: normalizeSitePolicies([rule("https://WWW.Example.com/Video/")]),
        },
      });
      expect((await getSettings()).siteSettings.sitePolicies.map(({ pattern }) => pattern)).toEqual(
        ["example.com/Video"],
      );
    });

    it("ignores non-http URLs", () => {
      expect(match("chrome://extensions", "extensions")).toBeUndefined();
      expect(match("file:///tmp/video.mp4", "tmp")).toBeUndefined();
    });

    it("keeps saved patterns as stored when loading settings", async () => {
      await saveSettings({
        siteSettings: {
          sitePolicies: [
            rule("youtube.com/shorts/"),
            rule(" Vimeo.com "),
            rule("not a site"),
            rule("https://www.youtube.com/"),
          ],
        },
      });

      expect((await getSettings()).siteSettings.sitePolicies.map(({ pattern }) => pattern)).toEqual(
        ["vimeo.com", "youtube.com/shorts"],
      );
    });
  });
});
