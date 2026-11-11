import { beforeEach, describe, expect, it } from "vitest";
import {
  emitStorageChange,
  findRowByLabel,
  getSettingsMock,
  isDisplayed,
  loadQuickSettingsModule,
  resetQuickSettingsTestState,
  saveSettingsMock,
  setCheckbox,
  tabsCreateMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS, type ExtensionSettings, type SitePolicy } from "../../../src/storage.js";

beforeEach(() => {
  resetQuickSettingsTestState();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function settingsWithPolicies(sitePolicies: SitePolicy[]): ExtensionSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.siteSettings.sitePolicies = sitePolicies;
  return settings;
}

function expectSavedPolicies(sitePolicies: SitePolicy[]): void {
  expect(saveSettingsMock).toHaveBeenLastCalledWith({ siteSettings: { sitePolicies } });
}

function checkbox(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function text(id: string): string | null | undefined {
  return document.getElementById(id)?.textContent;
}

const DOMAIN_DISABLED: SitePolicy = {
  pattern: "youtube.com",
  policy: "disabled",
  embedsPolicy: "inherit",
};
const SECTION_DISABLED: SitePolicy = {
  pattern: "youtube.com/shorts",
  policy: "disabled",
  embedsPolicy: "inherit",
};
const SECTION_ENABLED: SitePolicy = {
  pattern: "youtube.com/shorts",
  policy: "enabled",
  embedsPolicy: "inherit",
};

describe("quick settings popup: load and save", () => {
  it("shows the extension version after the name", async () => {
    await loadQuickSettingsModule();

    expect(text("extension-version")).toBe("v1.2.3");
  });

  it("loads key bindings and shows them while the extension is enabled", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    expect(checkbox("disable-everywhere").checked).toBe(false);
    expect(isDisplayed("key-bindings-section")).toBe(true);
    const row = findRowByLabel("Play/Pause");
    const keys = Array.from(row.querySelectorAll(".key-chip")).map((chip) =>
      chip.firstChild?.textContent?.trim(),
    );
    expect(keys).toContain("x");
  });

  it("hides the key bindings when loaded with the extension disabled everywhere", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.hotkeysEnabled = false;

    await loadQuickSettingsModule(settings);

    expect(checkbox("disable-everywhere").checked).toBe(true);
    expect(isDisplayed("key-bindings-section")).toBe(false);
  });

  it("disables and re-enables the extension everywhere without a toast", async () => {
    await loadQuickSettingsModule();

    setCheckbox("disable-everywhere", true);
    await flush();

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      quickSettings: { hotkeysEnabled: false },
    });
    expect(isDisplayed("key-bindings-section")).toBe(false);

    setCheckbox("disable-everywhere", false);
    await flush();

    expect(saveSettingsMock).toHaveBeenCalledTimes(2);
    expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
      quickSettings: { hotkeysEnabled: true },
    });
    expect(isDisplayed("key-bindings-section")).toBe(true);
    expect(text("announcements")).toBe("");
  });

  it("hides the site checkboxes while the extension is disabled everywhere", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED]),
      "https://www.youtube.com/shorts/abc",
    );
    await flush();

    expect(isDisplayed("disable-on-site-field")).toBe(true);
    expect(isDisplayed("site-section-field")).toBe(true);

    setCheckbox("disable-everywhere", true);
    await flush();

    expect(isDisplayed("disable-on-site-field")).toBe(false);
    expect(isDisplayed("site-section-field")).toBe(false);
    expect(isDisplayed("site-rule-row")).toBe(false);

    setCheckbox("disable-everywhere", false);
    await flush();

    expect(isDisplayed("disable-on-site-field")).toBe(true);
    expect(isDisplayed("site-section-field")).toBe(true);
  });

  it("stops listening for a new key when the extension is disabled everywhere", async () => {
    await loadQuickSettingsModule();

    const addButton = findRowByLabel("Play/Pause").querySelector(
      ".add-key-button",
    ) as HTMLButtonElement;
    addButton.click();
    setCheckbox("disable-everywhere", true);
    await flush();
    saveSettingsMock.mockClear();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await flush();

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(addButton.classList.contains("listening")).toBe(false);
  });

  it("disables the current domain from the checkbox", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/watch/1");
    await flush();

    expect(isDisplayed("disable-on-site-field")).toBe(true);
    expect(text("disable-on-site-label")).toBe("Disable on youtube.com");
    expect(checkbox("disable-on-site").checked).toBe(false);
    expect(isDisplayed("site-section-field")).toBe(true);
    expect(text("site-section-label")).toBe("Disable on youtube.com/watch");
    expect(isDisplayed("site-rule-row")).toBe(false);

    setCheckbox("disable-on-site", true);
    await flush();

    expectSavedPolicies([DOMAIN_DISABLED]);
    expect(isDisplayed("site-section-field")).toBe(true);
    expect(text("site-section-label")).toBe("Enable on youtube.com/watch");
    expect(checkbox("site-section").checked).toBe(false);
    expect(text("announcements")).toBe("");
    expect(tabsCreateMock).not.toHaveBeenCalled();
  });

  it("re-enables the current domain when the checkbox is cleared", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED, SECTION_ENABLED]),
      "https://www.youtube.com/watch/1",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(true);

    setCheckbox("disable-on-site", false);
    await flush();

    expectSavedPolicies([SECTION_ENABLED]);
    expect(isDisplayed("site-section-field")).toBe(true);
    expect(text("site-section-label")).toBe("Disable on youtube.com/watch");
    expect(checkbox("site-section").checked).toBe(false);
  });

  it("checks both boxes for rules added in advanced settings", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED, SECTION_ENABLED]),
      "https://www.youtube.com/shorts/abc",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(isDisplayed("site-section-field")).toBe(true);
    expect(text("site-section-label")).toBe("Enable on youtube.com/shorts");
    expect(checkbox("site-section").checked).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);
  });

  it("shows a Disable checkbox for the first path segment while the domain is enabled", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/shorts/abc");
    await flush();

    expect(isDisplayed("site-section-field")).toBe(true);
    expect(text("site-section-label")).toBe("Disable on youtube.com/shorts");
    expect(checkbox("site-section").checked).toBe(false);

    setCheckbox("site-section", true);
    await flush();

    expectSavedPolicies([SECTION_DISABLED]);
    expect(checkbox("site-section").checked).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);

    setCheckbox("site-section", false);
    await flush();

    expectSavedPolicies([]);
    expect(text("announcements")).toBe("");
  });

  it("switches the first path segment checkbox between Disable and Enable with the domain", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/shorts/abc");
    await flush();

    expect(text("site-section-label")).toBe("Disable on youtube.com/shorts");

    setCheckbox("disable-on-site", true);
    await flush();

    expect(text("site-section-label")).toBe("Enable on youtube.com/shorts");
    expect(checkbox("site-section").checked).toBe(false);

    setCheckbox("disable-on-site", false);
    await flush();

    expect(text("site-section-label")).toBe("Disable on youtube.com/shorts");
  });

  it("adds and removes a section override from the checkbox", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED]),
      "https://www.youtube.com/shorts/abc",
    );
    await flush();

    setCheckbox("site-section", true);
    await flush();

    expectSavedPolicies([DOMAIN_DISABLED, SECTION_ENABLED]);

    setCheckbox("site-section", false);
    await flush();

    expectSavedPolicies([DOMAIN_DISABLED]);
    expect(text("announcements")).toBe("");
  });

  it("hides the key bindings while a Disable checkbox is checked for the page", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/shorts/abc");
    await flush();

    expect(isDisplayed("key-bindings-section")).toBe(true);

    setCheckbox("site-section", true);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(false);

    setCheckbox("site-section", false);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(true);

    setCheckbox("disable-on-site", true);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(false);

    setCheckbox("disable-on-site", false);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(true);
  });

  it("shows the key bindings on a section re-enabled within a disabled domain", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED, SECTION_ENABLED]),
      "https://www.youtube.com/shorts/abc",
    );
    await flush();

    expect(isDisplayed("key-bindings-section")).toBe(true);

    setCheckbox("site-section", false);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(false);

    setCheckbox("site-section", true);
    await flush();
    expect(isDisplayed("key-bindings-section")).toBe(true);
  });

  it("keeps the key bindings when a Disable checkbox is checked for another section", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([SECTION_DISABLED]),
      "https://www.youtube.com/watch/1",
    );
    await flush();

    expect(isDisplayed("key-bindings-section")).toBe(true);
  });

  it("stops listening for a new key when a site checkbox hides the key bindings", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/watch/1");
    await flush();

    const addButton = findRowByLabel("Play/Pause").querySelector(
      ".add-key-button",
    ) as HTMLButtonElement;
    addButton.click();
    setCheckbox("disable-on-site", true);
    await flush();
    saveSettingsMock.mockClear();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await flush();

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(addButton.classList.contains("listening")).toBe(false);
  });

  it("hides the section checkbox when the first path segment has no trailing slash", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/watch?v=abc123");
    await flush();

    expect(isDisplayed("disable-on-site-field")).toBe(true);
    expect(isDisplayed("site-section-field")).toBe(false);
  });

  it("hides the section checkbox on the domain root", async () => {
    await loadQuickSettingsModule(settingsWithPolicies([DOMAIN_DISABLED]), "https://youtube.com/");
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(isDisplayed("site-section-field")).toBe(false);
  });

  it("names a deeper rule that decides the page and routes Edit site rule to it", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([
        { pattern: "youtube.com/shorts/abc", policy: "disabled", embedsPolicy: "inherit" },
      ]),
      "https://www.youtube.com/shorts/abc",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(false);
    expect(isDisplayed("site-rule-row")).toBe(true);
    expect(text("site-control-status")).toBe("Disabled here by rule: youtube.com/shorts/abc");

    (document.getElementById("site-edit-rule-button") as HTMLButtonElement).click();
    await flush();

    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "chrome-extension://test/advanced-settings-page.html?highlightDisabledSiteUrl=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc",
    });
  });

  it("creates host rules from the current subdomain", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://music.youtube.com/browse/abc");
    await flush();

    expect(text("disable-on-site-label")).toBe("Disable on music.youtube.com");
    expect(text("site-section-label")).toBe("Disable on music.youtube.com/browse");

    setCheckbox("disable-on-site", true);
    await flush();

    expectSavedPolicies([
      { pattern: "music.youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ]);
    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);
    expect(text("site-section-label")).toBe("Enable on music.youtube.com/browse");

    setCheckbox("site-section", true);
    await flush();

    expectSavedPolicies([
      { pattern: "music.youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "music.youtube.com/browse", policy: "enabled", embedsPolicy: "inherit" },
    ]);
  });

  it("drops only a leading www. from the current host", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.docs.google.com/");
    await flush();
    expect(text("disable-on-site-label")).toBe("Disable on docs.google.com");

    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://m.youtube.com/");
    await flush();
    expect(text("disable-on-site-label")).toBe("Disable on m.youtube.com");
  });

  it("keeps each site on a shared host separate", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://alice.github.io/blog/post");
    await flush();

    expect(text("disable-on-site-label")).toBe("Disable on alice.github.io");
    expect(text("site-section-label")).toBe("Disable on alice.github.io/blog");
  });

  it("names a wider rule that decides the page and routes Edit site rule to it", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED]),
      "https://music.youtube.com/browse",
    );
    await flush();

    expect(text("disable-on-site-label")).toBe("Disable on music.youtube.com");
    expect(checkbox("disable-on-site").checked).toBe(false);
    expect(isDisplayed("site-rule-row")).toBe(true);
    expect(text("site-control-status")).toBe("Disabled here by rule: youtube.com");

    (document.getElementById("site-edit-rule-button") as HTMLButtonElement).click();
    await flush();

    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "chrome-extension://test/advanced-settings-page.html?highlightDisabledSiteUrl=https%3A%2F%2Fmusic.youtube.com%2Fbrowse",
    });
  });

  it("hides the key bindings and offers to enable the section when a wider rule disables the site", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED]),
      "https://music.youtube.com/browse/abc",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(false);
    expect(isDisplayed("key-bindings-section")).toBe(false);
    expect(text("site-section-label")).toBe("Enable on music.youtube.com/browse");
    expect(checkbox("site-section").checked).toBe(false);
    expect(text("site-control-status")).toBe("Disabled here by rule: youtube.com");

    setCheckbox("site-section", true);
    await flush();

    expectSavedPolicies([
      { pattern: "music.youtube.com/browse", policy: "enabled", embedsPolicy: "inherit" },
      DOMAIN_DISABLED,
    ]);
    expect(isDisplayed("key-bindings-section")).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);
  });

  it("shows the key bindings when a subdomain rule enables it inside a disabled domain", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([
        DOMAIN_DISABLED,
        { pattern: "music.youtube.com", policy: "enabled", embedsPolicy: "inherit" },
      ]),
      "https://music.youtube.com/browse/abc",
    );
    await flush();

    expect(isDisplayed("key-bindings-section")).toBe(true);
    expect(text("site-section-label")).toBe("Disable on music.youtube.com/browse");
  });

  it("lets a subdomain rule disable a site that a wider rule enables", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([
        { pattern: "youtube.com", policy: "enabled", embedsPolicy: "inherit" },
        { pattern: "music.youtube.com", policy: "disabled", embedsPolicy: "inherit" },
        { pattern: "music.youtube.com/browse", policy: "enabled", embedsPolicy: "inherit" },
      ]),
      "https://music.youtube.com/browse/abc",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(text("site-section-label")).toBe("Enable on music.youtube.com/browse");
    expect(checkbox("site-section").checked).toBe(true);
    expect(isDisplayed("key-bindings-section")).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);

    setCheckbox("site-section", false);
    await flush();

    expect(isDisplayed("key-bindings-section")).toBe(false);
  });

  it("stops naming the wider rule once the subdomain has its own", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([DOMAIN_DISABLED]),
      "https://music.youtube.com/",
    );
    await flush();
    expect(isDisplayed("site-rule-row")).toBe(true);

    setCheckbox("disable-on-site", true);
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(isDisplayed("site-rule-row")).toBe(false);
  });

  it("names an enabled subdomain rule that overrides a disabled domain", async () => {
    await loadQuickSettingsModule(
      settingsWithPolicies([
        DOMAIN_DISABLED,
        { pattern: "music.youtube.com", policy: "enabled", embedsPolicy: "inherit" },
      ]),
      "https://music.youtube.com/",
    );
    await flush();

    expect(checkbox("disable-on-site").checked).toBe(false);
    expect(text("site-control-status")).toBe("Enabled here by rule: music.youtube.com");
  });

  it("shows only the global checkbox on browser internal pages", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "chrome://extensions");
    await flush();

    expect(isDisplayed("site-controls-container")).toBe(true);
    expect(isDisplayed("disable-on-site-field")).toBe(false);
    expect(isDisplayed("site-section-field")).toBe(false);
    expect(isDisplayed("site-rule-row")).toBe(false);
  });

  it("shows a site rule saved elsewhere and sends only the next site change", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/shorts/abc");
    await flush();
    expect(checkbox("disable-on-site").checked).toBe(false);

    getSettingsMock.mockResolvedValue(settingsWithPolicies([DOMAIN_DISABLED]));
    await emitStorageChange();

    expect(checkbox("disable-on-site").checked).toBe(true);
    expect(isDisplayed("key-bindings-section")).toBe(false);

    setCheckbox("disable-on-site", false);
    await flush();

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenLastCalledWith({ siteSettings: { sitePolicies: [] } });
  });
});
