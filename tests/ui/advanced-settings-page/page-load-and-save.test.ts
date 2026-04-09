import { beforeEach, describe, expect, it } from "vitest";
import {
  loadAdvancedSettingsModule,
  resetAdvancedSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetAdvancedSettingsTestState();
});

describe("advanced settings page: load and save", () => {
  it("loads advanced settings into the form", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.1;
    settings.advancedSettings.useNumberKeysToJump = false;
    settings.advancedSettings.sumQuickSkips = false;

    await loadAdvancedSettingsModule(settings);

    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe("10");
    expect((document.getElementById("useNumberKeysToJump") as HTMLInputElement).checked).toBe(
      false,
    );
    expect((document.getElementById("sumQuickSkips") as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById("showOverlays") as HTMLInputElement).checked).toBe(
      settings.advancedSettings.showOverlays,
    );
    expect((document.getElementById("debugLogging") as HTMLInputElement).checked).toBe(
      settings.advancedSettings.debugLogging,
    );
    expect((document.getElementById("skipOverlayPosition") as HTMLSelectElement).value).toBe(
      settings.advancedSettings.skipOverlayPosition,
    );
  });

  it("saves edited advanced settings on input", async () => {
    await loadAdvancedSettingsModule();

    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "2";
    volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: expect.objectContaining({
        volumeStep: 0.02,
      }),
    });
  });

  it("saves checkbox changes on change", async () => {
    await loadAdvancedSettingsModule();

    const useNumberKeysToJump = document.getElementById("useNumberKeysToJump") as HTMLInputElement;
    useNumberKeysToJump.checked = false;
    useNumberKeysToJump.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      advancedSettings: expect.objectContaining({
        useNumberKeysToJump: false,
      }),
    });
  });
});
