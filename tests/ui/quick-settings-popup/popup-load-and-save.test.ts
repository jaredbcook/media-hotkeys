import { beforeEach, describe, expect, it } from "vitest";
import {
  findRowByLabel,
  loadQuickSettingsModule,
  resetQuickSettingsTestState,
  saveSettingsMock,
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
});
