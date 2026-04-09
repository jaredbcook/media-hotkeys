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

describe("advanced settings page: reset behavior", () => {
  it("resets only advanced settings to defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.volumeStep = 0.2;
    settings.quickSettings.hotkeysEnabled = false;
    settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];

    await loadAdvancedSettingsModule(settings);

    document.getElementById("reset")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      quickSettings: {
        hotkeysEnabled: false,
        actionKeyBindings: {
          togglePlayPause: {
            keys: ["x"],
          },
        },
      },
      advancedSettings: DEFAULT_SETTINGS.advancedSettings,
    });
    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe(
      String(DEFAULT_SETTINGS.advancedSettings.volumeStep * 100),
    );
  });
});
