import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSettingsMock,
  loadQuickSettingsModule,
  openOptionsPageMock,
  renderQuickSettingsDom,
  resetQuickSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetQuickSettingsTestState();
});

describe("quick settings popup: status, reset, and error handling", () => {
  it("resets only quick settings to defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.hotkeysEnabled = false;
    settings.advancedSettings.volumeStep = 0.2;
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    document.getElementById("reset")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: {
        volumeStep: 0.2,
      },
    });
    expect((document.getElementById("hotkeysEnabled") as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.quickSettings.hotkeysEnabled,
    );
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Quick settings reset to default values.",
    );
  });

  it("fades out the active status announcement when a new one is shown", async () => {
    await loadQuickSettingsModule();

    const hotkeysEnabled = document.getElementById("hotkeysEnabled") as HTMLInputElement;

    hotkeysEnabled.checked = false;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    hotkeysEnabled.checked = true;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const visibleAnnouncements = Array.from(
      document.querySelectorAll("#announcements .announcement:not(.announcement-exiting)"),
    ).map((announcement) => announcement.textContent);
    const exitingAnnouncement = document.querySelector(
      "#announcements .announcement-exiting",
    ) as HTMLDivElement | null;

    expect(visibleAnnouncements).toEqual(["Hotkeys enabled"]);
    expect(exitingAnnouncement?.textContent).toBe("Hotkeys disabled");
  });

  it("shows status announcements when hotkeys are enabled or disabled", async () => {
    await loadQuickSettingsModule();

    const hotkeysEnabled = document.getElementById("hotkeysEnabled") as HTMLInputElement;

    hotkeysEnabled.checked = false;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("announcements")?.textContent).toContain("Hotkeys disabled");

    hotkeysEnabled.checked = true;
    hotkeysEnabled.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("announcements")?.textContent).toContain("Hotkeys enabled");
  });

  it("shows a failure announcement when quick settings cannot be loaded", async () => {
    vi.resetModules();
    renderQuickSettingsDom();
    getSettingsMock.mockRejectedValueOnce(new Error("storage unavailable"));

    await import("../../../src/quick-settings-popup.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("announcements")?.textContent).toContain(
      "Failed to load quick settings. Try reinstalling the extension or restarting the browser.",
    );
  });

  it("opens the advanced settings page from the Advanced Settings button", async () => {
    await loadQuickSettingsModule();

    document.getElementById("advanced-settings")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openOptionsPageMock).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
  });
});
