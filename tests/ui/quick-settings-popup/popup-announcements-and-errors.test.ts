import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerConfirmDialog, getConfirmDialog, installDialogStub } from "../dialog-stub.js";
import {
  findRowByLabel,
  getSettingsMock,
  loadQuickSettingsModule,
  openOptionsPageMock,
  renderQuickSettingsDom,
  resetQuickSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  installDialogStub();
  getConfirmDialog()?.close();
  resetQuickSettingsTestState();
});

describe("quick settings popup: status, reset, and error handling", () => {
  it("resets only quick settings to defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.2;
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    document.getElementById("reset")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getConfirmDialog()?.textContent).toContain("Restore default key bindings?");
    expect(saveSettingsMock).not.toHaveBeenCalled();

    await answerConfirmDialog("confirm");

    expect(getConfirmDialog()).toBeNull();
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    // Only the binding that differed from the default is sent, and nothing outside this popup.
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      quickSettings: { actionKeyBindings: { togglePlayPause: { keys: ["k"] } } },
    });
    expect((document.getElementById("disable-everywhere") as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById("key-bindings-section")?.style.display).not.toBe("none");
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Quick settings reset to default values.",
    );
  });

  it("keeps the key bindings when the confirmation is canceled", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    document.getElementById("reset")?.click();
    await answerConfirmDialog("cancel");

    expect(getConfirmDialog()).toBeNull();
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(findRowByLabel("Play/Pause").querySelector(".key-chip-label")?.textContent).toBe("x");
    expect(document.getElementById("announcements")?.textContent).not.toContain(
      "Quick settings reset to default values.",
    );
  });

  it("keeps the key bindings when the confirmation is dismissed without an answer", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadQuickSettingsModule(settings);

    document.getElementById("reset")?.click();
    getConfirmDialog()?.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(findRowByLabel("Play/Pause").querySelector(".key-chip-label")?.textContent).toBe("x");
  });

  it("stops a pending key capture so the confirmation can be operated by keyboard", async () => {
    await loadQuickSettingsModule();

    const addButton = findRowByLabel("Play/Pause").querySelector(
      ".add-key-button",
    ) as HTMLButtonElement;
    addButton.click();
    expect(addButton.classList.contains("listening")).toBe(true);

    document.getElementById("reset")?.click();
    expect(addButton.classList.contains("listening")).toBe(false);

    const keydown = new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true });
    document.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);

    await answerConfirmDialog("cancel");
    expect(saveSettingsMock).not.toHaveBeenCalled();
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
