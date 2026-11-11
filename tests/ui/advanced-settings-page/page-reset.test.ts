import { beforeEach, describe, expect, it } from "vitest";
import {
  loadAdvancedSettingsModule,
  resetAdvancedSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import { answerConfirmDialog, getConfirmDialog, installDialogStub } from "../dialog-stub.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  installDialogStub();
  getConfirmDialog()?.close();
  resetAdvancedSettingsTestState();
});

describe("advanced settings page: reset behavior", () => {
  it("resets only advanced settings to defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.2;
    settings.quickSettings.hotkeysEnabled = false;
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadAdvancedSettingsModule(settings);

    document.getElementById("reset")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getConfirmDialog()?.textContent).toContain("Restore default advanced settings?");
    expect(saveSettingsMock).not.toHaveBeenCalled();

    await answerConfirmDialog("confirm");

    expect(getConfirmDialog()).toBeNull();
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    // Only the setting that differed from the default is sent, and nothing outside this page.
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({ advancedSettings: { volumeStep: 0.05 } });
    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe(
      String(DEFAULT_SETTINGS.advancedSettings.volumeStep * 100),
    );
  });

  it("keeps the settings when the confirmation is canceled", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.2;

    await loadAdvancedSettingsModule(settings);

    document.getElementById("reset")?.click();
    await answerConfirmDialog("cancel");

    expect(getConfirmDialog()).toBeNull();
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe("20");
  });

  it("keeps the settings when the confirmation is dismissed without an answer", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.2;

    await loadAdvancedSettingsModule(settings);

    document.getElementById("reset")?.click();
    getConfirmDialog()?.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe("20");
  });
});
