import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAdvancedSettingsModule,
  resetAdvancedSettingsTestState,
  saveSettingsMock,
} from "./helpers.js";
import {
  DEFAULT_SETTINGS,
  type AdvancedSettings,
  type NumericAdvancedSetting,
} from "../../../src/storage.js";

beforeEach(() => {
  resetAdvancedSettingsTestState();
});

afterEach(() => {
  vi.useRealTimers();
});

// Values storage accepts but the page's whole-number fields can't show as a whole number. The
// volume step is stored as a fraction and shown as a percentage.
const NON_WHOLE_VALUES: [NumericAdvancedSetting, number, string][] = [
  ["seekStepSmall", 2.5, "2.5"],
  ["seekStepMedium", 30.5, "30.5"],
  ["seekStepLarge", 90.25, "90.25"],
  ["volumeStep", 0.025, "2.5"],
  ["overlayVisibleDuration", 725.5, "725.5"],
  ["overlayFadeDuration", 275.5, "275.5"],
];

async function loadWith(overrides: Partial<AdvancedSettings>): Promise<void> {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.advancedSettings, overrides);
  await loadAdvancedSettingsModule(settings);
}

function getInput(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

describe("advanced settings page: fields the user didn't edit", () => {
  it.each(NON_WHOLE_VALUES)(
    "keeps a stored %s of %s when another setting is saved",
    async (name, stored, shown) => {
      await loadWith({ [name]: stored, debugLogging: false });
      expect(getInput(name).value).toBe(shown);

      const debugLogging = getInput("debugLogging");
      debugLogging.checked = true;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(saveSettingsMock).toHaveBeenCalledOnce();
      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        advancedSettings: { debugLogging: true },
      });
      expect(getInput(name).value).toBe(shown);
    },
  );

  it("keeps non-whole fields when a different number field is edited", async () => {
    await loadWith({ seekStepSmall: 2.5, volumeStep: 0.025 });
    vi.useFakeTimers();

    const seekStepLarge = getInput("seekStepLarge");
    seekStepLarge.value = "120";
    seekStepLarge.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: { seekStepLarge: 120 },
    });
    expect(getInput("seekStepSmall").value).toBe("2.5");
    expect(getInput("volumeStep").value).toBe("2.5");
  });

  it("keeps non-whole fields when a site policy is saved", async () => {
    await loadWith({ seekStepSmall: 2.5 });
    vi.useFakeTimers();

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    pattern!.value = "youtube.com";
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
      },
    });
    expect(getInput("seekStepSmall").value).toBe("2.5");
  });

  it("leaves a field alone when it is focused and left without a change", async () => {
    await loadWith({ seekStepSmall: 2.5 });

    const seekStepSmall = getInput("seekStepSmall");
    seekStepSmall.dispatchEvent(new Event("blur", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seekStepSmall.value).toBe("2.5");
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("still rounds a field the user edits", async () => {
    await loadWith({ seekStepSmall: 2.5 });
    vi.useFakeTimers();

    const seekStepSmall = getInput("seekStepSmall");
    seekStepSmall.value = "4.4";
    seekStepSmall.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(seekStepSmall.value).toBe("4");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: { seekStepSmall: 4 },
    });
  });

  it("keeps a field after an edit to it is saved, while others stay untouched", async () => {
    await loadWith({ seekStepSmall: 2.5, seekStepMedium: 30.5 });
    vi.useFakeTimers();

    const seekStepSmall = getInput("seekStepSmall");
    seekStepSmall.value = "6";
    seekStepSmall.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    const debugLogging = getInput("debugLogging");
    debugLogging.checked = !debugLogging.checked;
    debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(saveSettingsMock).toHaveBeenCalledTimes(2);
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({ advancedSettings: { seekStepSmall: 6 } });
    expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
      advancedSettings: { debugLogging: !DEFAULT_SETTINGS.advancedSettings.debugLogging },
    });
    expect(getInput("seekStepMedium").value).toBe("30.5");
  });
  describe("an edit that is pending while another save runs", () => {
    function editVolumeStep(): HTMLInputElement {
      const volumeStep = getInput("volumeStep");
      volumeStep.value = "7";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      return volumeStep;
    }

    function toggleDebugLogging(): void {
      const debugLogging = getInput("debugLogging");
      debugLogging.checked = !debugLogging.checked;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
    }

    it("still saves it after a site policy is saved, on blur and with the next setting", async () => {
      await loadWith({});
      vi.useFakeTimers();

      const volumeStep = editVolumeStep();
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
      pattern!.value = "youtube.com";
      pattern!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);

      expect(saveSettingsMock).toHaveBeenCalledOnce();
      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        siteSettings: {
          sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
        },
      });

      toggleDebugLogging();
      await vi.advanceTimersByTimeAsync(0);

      expect(saveSettingsMock).toHaveBeenCalledTimes(2);
      expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
        advancedSettings: {
          volumeStep: 0.07,
          debugLogging: !DEFAULT_SETTINGS.advancedSettings.debugLogging,
        },
      });
      expect(volumeStep.value).toBe("7");
    });

    it("still saves it on blur after a site policy is saved", async () => {
      await loadWith({});
      vi.useFakeTimers();

      const volumeStep = editVolumeStep();
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
      pattern!.value = "youtube.com";
      pattern!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);
      expect(saveSettingsMock).toHaveBeenCalledOnce();

      volumeStep.dispatchEvent(new Event("blur", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      toggleDebugLogging();
      await vi.advanceTimersByTimeAsync(0);

      expect(saveSettingsMock).toHaveBeenCalledTimes(3);
      expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
        advancedSettings: { volumeStep: 0.07 },
      });
      expect(saveSettingsMock.mock.calls[2]?.[0]).toEqual({
        advancedSettings: { debugLogging: !DEFAULT_SETTINGS.advancedSettings.debugLogging },
      });
    });

    it("still saves it after a save stopped at an empty field", async () => {
      await loadWith({});
      vi.useFakeTimers();

      const volumeStep = editVolumeStep();
      const speedMin = getInput("speedMin");
      const speedMinValue = speedMin.value;
      speedMin.value = "";
      toggleDebugLogging();
      await vi.advanceTimersByTimeAsync(0);
      expect(saveSettingsMock).not.toHaveBeenCalled();

      // The checkbox keeps its new state; the field is filled in again and the change is sent.
      speedMin.value = speedMinValue;
      getInput("debugLogging").dispatchEvent(new Event("change", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);

      expect(saveSettingsMock).toHaveBeenCalledOnce();
      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        advancedSettings: {
          volumeStep: 0.07,
          debugLogging: !DEFAULT_SETTINGS.advancedSettings.debugLogging,
        },
      });
      expect(volumeStep.value).toBe("7");
    });
  });
});
