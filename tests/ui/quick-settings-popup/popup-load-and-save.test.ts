import { beforeEach, describe, expect, it } from "vitest";
import {
  findRowByLabel,
  loadQuickSettingsModule,
  resetQuickSettingsTestState,
  saveSettingsMock,
  tabsCreateMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetQuickSettingsTestState();
});

describe("quick settings popup: load and save", () => {
  it("loads quick settings and action key bindings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.hotkeysEnabled = false;
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    expect((document.getElementById("hotkeysEnabled") as HTMLInputElement).checked).toBe(false);
    const row = findRowByLabel("Play/Pause");
    const keys = Array.from(row.querySelectorAll(".key-chip")).map((chip) =>
      chip.firstChild?.textContent?.trim(),
    );
    expect(keys).toContain("x");
  });

  it("saves the hotkeys enabled checkbox on change", async () => {
    await loadQuickSettingsModule();

    const hotkeysEnabled = document.getElementById("hotkeysEnabled") as HTMLInputElement;
    hotkeysEnabled.checked = false;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      quickSettings: expect.objectContaining({
        hotkeysEnabled: false,
      }),
    });
  });

  it("does not save the hotkeys enabled checkbox when the value is unchanged", async () => {
    await loadQuickSettingsModule();

    const hotkeysEnabled = document.getElementById("hotkeysEnabled") as HTMLInputElement;
    hotkeysEnabled.checked = true;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("immediately disables the current hostname from quick settings", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "https://www.youtube.com/watch?v=1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const container = document.getElementById("site-controls-container") as HTMLDivElement;
    expect(container.style.display).not.toBe("none");

    const button = document.getElementById("site-control-button") as HTMLButtonElement;
    expect(document.getElementById("site-control-status")?.textContent).toBe(
      "Media Hotkeys enabled on youtube.com",
    );
    expect(button.textContent).toBe("Disable on youtube.com");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledWith({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: DEFAULT_SETTINGS.advancedSettings,
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
        disabledUrlPatterns: ["youtube.com"],
      },
    });
    expect(tabsCreateMock).not.toHaveBeenCalled();
  });

  it("creates a section-level enabled override when a broad disabled rule matches", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["youtube.com"];

    await loadQuickSettingsModule(settings, "https://www.youtube.com/shorts/abc");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const container = document.getElementById("site-controls-container") as HTMLDivElement;
    expect(container.style.display).not.toBe("none");

    const button = document.getElementById("site-control-button") as HTMLButtonElement;
    expect(document.getElementById("site-control-status")?.textContent).toBe(
      "Media Hotkeys disabled by rule: youtube.com",
    );
    expect(button.textContent).toBe("Enable on this section");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledWith({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: DEFAULT_SETTINGS.advancedSettings,
      siteSettings: {
        sitePolicies: [
          { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
          { pattern: "youtube.com/shorts", policy: "enabled", embedsPolicy: "inherit" },
        ],
        disabledUrlPatterns: ["youtube.com"],
      },
    });
  });

  it("removes an exact disabled rule when enabling the current site", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["youtube.com/shorts"];

    await loadQuickSettingsModule(settings, "https://www.youtube.com/shorts/abc");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = document.getElementById("site-control-button") as HTMLButtonElement;
    expect(button.textContent).toBe("Enable on this site");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledWith({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: DEFAULT_SETTINGS.advancedSettings,
      siteSettings: {
        sitePolicies: [],
        disabledUrlPatterns: [],
      },
    });
  });

  it("routes Edit site rule to advanced settings with the matching URL highlighted", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["youtube.com/shorts"];

    await loadQuickSettingsModule(settings, "https://www.youtube.com/shorts/abc");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const editButton = document.getElementById("site-edit-rule-button") as HTMLButtonElement;
    expect(editButton.style.display).not.toBe("none");

    editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "chrome-extension://test/advanced-settings-page.html?highlightDisabledSiteUrl=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc",
    });
  });

  it("shows unavailable site controls for browser internal pages", async () => {
    await loadQuickSettingsModule(DEFAULT_SETTINGS, "chrome://extensions");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const container = document.getElementById("site-controls-container") as HTMLDivElement;
    expect(container.style.display).toBe("none");
  });
});
