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
    expect((document.getElementById("disable-everywhere") as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById("key-bindings-section")?.style.display).not.toBe("none");
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Quick settings reset to default values.",
    );
  });

  it("fades out the active status announcement when a new one is shown", async () => {
    await loadQuickSettingsModule();

    const addButton = document.querySelector(".add-key-button") as HTMLButtonElement;
    addButton.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const visibleAnnouncements = Array.from(
      document.querySelectorAll("#announcements .announcement:not(.announcement-exiting)"),
    ).map((announcement) => announcement.textContent);
    const exitingAnnouncement = document.querySelector(
      "#announcements .announcement-exiting",
    ) as HTMLDivElement | null;

    expect(visibleAnnouncements).toEqual(["Key assignment canceled for Play/Pause."]);
    expect(exitingAnnouncement?.textContent).toBe(
      "Listening for a shortcut key for Play/Pause. Press Escape to cancel.",
    );
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
