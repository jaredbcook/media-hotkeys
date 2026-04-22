import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAdvancedSettingsModule,
  resetAdvancedSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetAdvancedSettingsTestState();
});

afterEach(() => {
  vi.useRealTimers();
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

  it("debounces saves for edited text and number inputs", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "2";
    volumeStep.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(499);

    expect(saveSettingsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      quickSettings: DEFAULT_SETTINGS.quickSettings,
      advancedSettings: expect.objectContaining({
        volumeStep: 0.02,
      }),
    });
    expect(document.querySelector("#announcements .announcement")?.textContent).toContain(
      "Settings saved.",
    );
  });

  it("clamps numeric inputs to their closest valid value before saving", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "20";
    volumeStep.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(volumeStep.value).toBe("10");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      advancedSettings: expect.objectContaining({
        volumeStep: 0.1,
      }),
    });
  });

  it("reverts empty text and number inputs to their last valid value on blur", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "";
    volumeStep.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).not.toHaveBeenCalled();

    volumeStep.dispatchEvent(new Event("blur", { bubbles: true }));
    await Promise.resolve();

    expect(volumeStep.value).toBe("5");
    expect(saveSettingsMock).not.toHaveBeenCalled();
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
    expect(document.querySelector("#announcements .announcement")?.getAttribute("role")).toBe(
      "status",
    );
  });

  it("does not save checkbox changes when the value is unchanged", async () => {
    await loadAdvancedSettingsModule();

    const useNumberKeysToJump = document.getElementById("useNumberKeysToJump") as HTMLInputElement;
    useNumberKeysToJump.checked = true;
    useNumberKeysToJump.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(document.querySelector("#announcements .announcement")).toBeNull();
  });

  it("does not save debounced inputs when the normalized value is unchanged", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "5.0";
    volumeStep.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(document.querySelector("#announcements .announcement")).toBeNull();
  });

  it("saves debug logging changes on change", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.debugLogging = false;
    await loadAdvancedSettingsModule(settings);

    const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;
    debugLogging.checked = true;
    debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      advancedSettings: expect.objectContaining({
        debugLogging: true,
      }),
    });
  });
});
