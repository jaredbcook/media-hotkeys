import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitStorageChange,
  getSettingsMock,
  loadAdvancedSettingsModule,
  renderAdvancedSettingsDom,
  resetAdvancedSettingsTestState,
  readShippedNumberInputs,
  saveSettingsMock,
} from "./helpers.js";
import {
  ADVANCED_NUMBER_LIMITS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type NumericAdvancedSetting,
} from "../../../src/storage.js";

beforeEach(() => {
  resetAdvancedSettingsTestState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("advanced settings page: load and save", () => {
  it("shows the version and links to a bug report that includes it", async () => {
    await loadAdvancedSettingsModule();

    expect(document.getElementById("extension-version")?.textContent).toBe("v1.2.3");
    const link = new URL((document.getElementById("report-issue-link") as HTMLAnchorElement).href);
    expect(link.origin + link.pathname).toBe(
      "https://github.com/jaredbcook/media-hotkeys/issues/new",
    );
    expect(link.searchParams.get("template")).toBe("bug.md");
    expect(link.searchParams.get("body")).toContain("Media Hotkeys 1.2.3");
  });

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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({ advancedSettings: { volumeStep: 0.02 } });
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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: {
        volumeStep: 0.1,
      },
    });
  });

  it("allows 1 to 600 whole seconds for every skip in the shipped page", () => {
    const inputs = new Map(readShippedNumberInputs().map((input) => [input.id, input]));

    for (const id of ["seekStepSmall", "seekStepMedium", "seekStepLarge"]) {
      const input = inputs.get(id) as HTMLInputElement;
      expect([id, input.min, input.max, input.step]).toEqual([id, "1", "600", "1"]);
    }
  });

  it("limits every number input to the range storage clamps its setting to", () => {
    const inputs = readShippedNumberInputs();

    expect(inputs.map((input) => input.id).sort()).toEqual(
      Object.keys(ADVANCED_NUMBER_LIMITS).sort(),
    );
    for (const input of inputs) {
      const { min, max } = ADVANCED_NUMBER_LIMITS[input.id as NumericAdvancedSetting];
      // The volume step is stored as a fraction and shown as a percentage.
      const scale = input.id === "volumeStep" ? 100 : 1;
      // Compare the attributes as written: a missing `min` reads as "" and would pass as 0.
      expect([input.id, input.getAttribute("min"), input.getAttribute("max")]).toEqual([
        input.id,
        String(Math.round(min * scale * 1e6) / 1e6),
        String(Math.round(max * scale * 1e6) / 1e6),
      ]);
    }
  });

  it.each([
    ["seekStepSmall", "300", "300"],
    ["seekStepMedium", "1", "1"],
    ["seekStepLarge", "600", "600"],
    ["seekStepSmall", "900", "600"],
    ["seekStepMedium", "0", "1"],
    ["seekStepLarge", "-5", "1"],
    ["seekStepLarge", "2.6", "3"],
  ])("normalizes %s %s to %s seconds before saving", async (id, entered, expected) => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    const input = document.getElementById(id) as HTMLInputElement;
    input.value = entered;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(input.value).toBe(expected);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: { [id]: Number(expected) },
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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: {
        useNumberKeysToJump: false,
      },
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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      advancedSettings: {
        debugLogging: true,
      },
    });
  });

  it("loads site policies into table rows", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "vimeo.com", policy: "enabled", embedsPolicy: "ignore" },
    ];
    await loadAdvancedSettingsModule(settings);

    const rows = document.querySelectorAll(".site-policy-row");
    expect(rows).toHaveLength(2);
    expect(document.querySelector<HTMLInputElement>(".site-policy-pattern")?.value).toBe(
      "vimeo.com",
    );

    const firstPattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    const firstMode = document.querySelector<HTMLSelectElement>(".site-policy-mode");
    const firstEmbeds = document.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    expect(firstPattern).toBeTruthy();
    expect(firstMode?.value).toBe("enabled");
    expect(firstEmbeds?.value).toBe("ignore");
    expect(document.querySelector("th:nth-child(1)")?.textContent).toBe("URL");
    expect(document.querySelector("th:nth-child(2)")?.textContent).toBe("Page Policy");
    expect(document.querySelector("th:nth-child(3)")?.textContent).toBe("Embeds Policy");
    expect(document.querySelector("th:nth-child(4)")?.textContent).toBe("Actions");
  });

  it("debounces and saves valid site policy URL edits", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "vimeo.com", policy: "enabled", embedsPolicy: "ignore" },
    ];
    await loadAdvancedSettingsModule(settings);
    vi.useFakeTimers();

    const youtubePattern = Array.from(
      document.querySelectorAll<HTMLInputElement>(".site-policy-pattern"),
    ).find((input) => input.value === "youtube.com");
    expect(youtubePattern).toBeTruthy();

    youtubePattern!.value = "https://www.youtube.com/shorts?feature=share#clip";
    youtubePattern!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(499);
    expect(saveSettingsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [
          { pattern: "vimeo.com", policy: "enabled", embedsPolicy: "ignore" },
          { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
        ],
      },
    });
    expect(youtubePattern!.value).toBe("youtube.com/shorts");
  });

  it("saves site policy dropdown changes immediately", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ];
    await loadAdvancedSettingsModule(settings);

    const mode = document.querySelector<HTMLSelectElement>(".site-policy-mode");
    const embedsPolicy = document.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    expect(mode).toBeTruthy();
    expect(embedsPolicy).toBeTruthy();

    mode!.value = "enabled";
    mode!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "enabled", embedsPolicy: "inherit" }],
      },
    });

    embedsPolicy!.value = "ignore";
    embedsPolicy!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledTimes(2);
    expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "enabled", embedsPolicy: "ignore" }],
      },
    });
  });

  it("adds site policies with inherited embeds behavior by default", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    expect(pattern).toBeTruthy();
    pattern!.value = "youtube.com";
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
      },
    });
  });

  it.each([
    ["music.youtube.com", "music.youtube.com"],
    ["https://Music.YouTube.com/browse/", "music.youtube.com/browse"],
    ["www.youtube.com", "youtube.com"],
    ["m.youtube.com", "m.youtube.com"],
    ["github.io", "github.io"],
    ["alice.github.io/blog", "alice.github.io/blog"],
  ])("saves the site policy %s as %s", async (typed, saved) => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    pattern!.value = typed;
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      siteSettings: {
        sitePolicies: [{ pattern: saved, policy: "disabled", embedsPolicy: "inherit" }],
      },
    });
    expect(pattern!.value).toBe(saved);
    expect(pattern!.getAttribute("aria-invalid")).not.toBe("true");
  });

  it.each(["com", "co.uk", "intranet"])("does not save %s, which is not a site", async (typed) => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    pattern!.value = typed;
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(pattern!.getAttribute("aria-invalid")).toBe("true");
  });

  it("adds new site policy rows to the bottom of the list", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "vimeo.com", policy: "enabled", embedsPolicy: "ignore" },
    ];
    await loadAdvancedSettingsModule(settings);

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const patterns = Array.from(
      document.querySelectorAll<HTMLInputElement>(".site-policy-pattern"),
    );
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.value).toBe("vimeo.com");
    expect(patterns[1]?.value).toBe("");
    expect(document.activeElement).toBe(patterns[1]);
  });

  it("keeps invalid site policy entries editable and does not save them", async () => {
    await loadAdvancedSettingsModule();
    vi.useFakeTimers();

    document
      .getElementById("add-site-policy")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    expect(pattern).toBeTruthy();
    pattern!.value = "not a site";
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(pattern!.value).toBe("not a site");
    expect(pattern!.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("site-policies-error")?.textContent).toContain("valid site");
  });

  it("renders a focused unsaved prefilled site policy from popup routing", async () => {
    await loadAdvancedSettingsModule(DEFAULT_SETTINGS, "?disabledSitePrefill=youtube.com");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    expect(pattern?.value).toBe("youtube.com");
    expect(document.activeElement).toBe(pattern);
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it("focuses the site policy row that matches the routed URL", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "vimeo.com/video-extra", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "vimeo.com/video", policy: "enabled", embedsPolicy: "inherit" },
    ];
    await loadAdvancedSettingsModule(
      settings,
      "?highlightDisabledSiteUrl=https%3A%2F%2Fplayer.vimeo.com%2Fvideo%2F1",
    );

    expect(document.querySelector(".site-policy-row-highlight")).toBeNull();
    const pattern = document.activeElement as HTMLInputElement;
    expect(pattern.value).toBe("vimeo.com/video");
    expect(document.activeElement).toBe(pattern);
  });

  it("clears the prefill URL param from browser history after autosaving site policies", async () => {
    await loadAdvancedSettingsModule(DEFAULT_SETTINGS, "?disabledSitePrefill=youtube.com");
    vi.useFakeTimers();

    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    expect(pattern).toBeTruthy();
    pattern!.value = "youtube.com/shorts";
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(window.location.search).not.toContain("disabledSitePrefill");
  });

  it("clears the highlight URL param from browser history after a site policy save attempt", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ];
    await loadAdvancedSettingsModule(
      settings,
      "?highlightDisabledSiteUrl=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc",
    );

    const embedsPolicy = document.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    expect(embedsPolicy).toBeTruthy();
    embedsPolicy!.value = "inherit";
    embedsPolicy!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Patterns are unchanged so saveSettings is not called, but URL param still clears
    expect(window.location.search).not.toContain("highlightDisabledSiteUrl");
  });

  it("clears URL params and does not save when site policy entries are invalid", async () => {
    await loadAdvancedSettingsModule(DEFAULT_SETTINGS, "?disabledSitePrefill=youtube.com");
    vi.useFakeTimers();

    const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern");
    expect(pattern).toBeTruthy();
    pattern!.value = "not a site";
    pattern!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("disabledSitePrefill");
  });

  it("clears URL params and does not save when other settings inputs are invalid", async () => {
    await loadAdvancedSettingsModule(DEFAULT_SETTINGS, "?disabledSitePrefill=youtube.com");

    // Invalidate an unrelated number field so normalizeEditableInputsForSave() fails
    const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
    volumeStep.value = "";

    const embedsPolicy = document.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    expect(embedsPolicy).toBeTruthy();
    embedsPolicy!.value = "ignore";
    embedsPolicy!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("disabledSitePrefill");
  });

  describe("settings changed elsewhere while the page is open", () => {
    function changeElsewhere(change: (settings: ExtensionSettings) => void): Promise<void> {
      const latest = structuredClone(DEFAULT_SETTINGS);
      change(latest);
      getSettingsMock.mockResolvedValue(latest);
      return emitStorageChange();
    }

    it("doesn't write back a key binding or showOverlays changed elsewhere", async () => {
      await loadAdvancedSettingsModule();

      // The popup rebinds Play/Pause and the `o` hotkey turns overlays off.
      await changeElsewhere((settings) => {
        settings.quickSettings.actionKeyBindings.togglePlayPause.keys = ["x"];
        settings.advancedSettings.showOverlays = false;
      });
      expect((document.getElementById("showOverlays") as HTMLInputElement).checked).toBe(false);

      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.value = "10";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Only the edited setting is sent, so overlays stay off and the binding is untouched.
      expect(saveSettingsMock).toHaveBeenCalledOnce();
      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        advancedSettings: { volumeStep: 0.1 },
      });
    });

    it("doesn't write back a setting changed elsewhere before the page learned of it", async () => {
      await loadAdvancedSettingsModule();

      // No change event has reached the page yet, so it still shows overlays on.
      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.value = "10";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        advancedSettings: { volumeStep: 0.1 },
      });
    });

    it("keeps what the user is typing and saves it", async () => {
      await loadAdvancedSettingsModule();
      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.focus();
      volumeStep.value = "7";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));

      await changeElsewhere((settings) => {
        settings.advancedSettings.speedStep = 0.5;
      });

      expect(volumeStep.value).toBe("7");
      expect((document.getElementById("speedStep") as HTMLInputElement).value).toBe("0.5");
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        advancedSettings: { volumeStep: 0.07 },
      });
    });

    it("ignores changes in other storage areas and its own saves", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockClear();

      await emitStorageChange("local");
      expect(getSettingsMock).not.toHaveBeenCalled();

      const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;
      debugLogging.checked = true;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The change event for that save reads storage as the save left it.
      await changeElsewhere((settings) => {
        settings.advancedSettings.debugLogging = true;
      });

      expect(debugLogging.checked).toBe(true);
      expect(saveSettingsMock).toHaveBeenCalledOnce();
    });

    it("shows the newest settings when an older read finishes last", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockReset();

      const older = structuredClone(DEFAULT_SETTINGS);
      older.advancedSettings.speedStep = 0.5;
      const newer = structuredClone(DEFAULT_SETTINGS);
      newer.advancedSettings.speedStep = 0.75;
      let finishOlderRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlderRead = () => resolve(older);
          }),
      );
      getSettingsMock.mockResolvedValueOnce(newer);

      await emitStorageChange();
      await emitStorageChange();
      finishOlderRead();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((document.getElementById("speedStep") as HTMLInputElement).value).toBe("0.75");
    });

    it("reads again when a change arrived while the page was still loading", async () => {
      const latest = structuredClone(DEFAULT_SETTINGS);
      latest.advancedSettings.speedStep = 0.5;
      // The first read starts before the change and finishes after it was announced.
      let finishFirstRead!: () => void;
      const stale = structuredClone(DEFAULT_SETTINGS);
      vi.resetModules();
      renderAdvancedSettingsDom();
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstRead = () => resolve(stale);
          }),
      );
      getSettingsMock.mockResolvedValue(latest);
      void import("../../../src/advanced-settings-page.js");
      await new Promise((resolve) => setTimeout(resolve, 0));

      await emitStorageChange();
      finishFirstRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect((document.getElementById("speedStep") as HTMLInputElement).value).toBe("0.5");
    });

    it("shows what is stored when a save fails, so the edit can be retried", async () => {
      await loadAdvancedSettingsModule();
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));

      const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;
      debugLogging.checked = true;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(document.querySelector("#announcements .announcement")?.textContent).toContain(
        "Failed to save settings.",
      );
      expect(debugLogging.checked).toBe(false);

      debugLogging.checked = true;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(saveSettingsMock).toHaveBeenCalledTimes(2);
      expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
        advancedSettings: { debugLogging: true },
      });
    });

    it("drops a failed edit from the focused field and rule row, so it can be retried", async () => {
      await loadAdvancedSettingsModule();
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.focus();
      volumeStep.value = "9";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(volumeStep.value).toBe("5");

      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern")!;
      pattern.focus();
      pattern.value = "vimeo.com";
      pattern.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(document.querySelectorAll(".site-policy-row")).toHaveLength(0);

      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const retry = document.querySelector<HTMLInputElement>(".site-policy-pattern")!;
      retry.value = "vimeo.com";
      retry.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(saveSettingsMock.mock.calls.at(-1)?.[0]).toEqual({
        siteSettings: {
          sitePolicies: [{ pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" }],
        },
      });
    });

    it("doesn't let the read after a failed save overwrite a newer edit", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockReset();
      let finishRecoveryRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRecoveryRead = () => resolve(structuredClone(DEFAULT_SETTINGS));
          }),
      );
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));

      const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;
      debugLogging.checked = true;
      debugLogging.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The user changes something else while the recovery read is still out.
      const sumQuickSkips = document.getElementById("sumQuickSkips") as HTMLInputElement;
      sumQuickSkips.checked = false;
      sumQuickSkips.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      finishRecoveryRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sumQuickSkips.checked).toBe(false);
    });

    it("keeps text typed while the read after a failed save was out", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockReset();
      let finishRecoveryRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRecoveryRead = () => resolve(structuredClone(DEFAULT_SETTINGS));
          }),
      );
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.focus();
      volumeStep.value = "9";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The user starts typing a new value before the read comes back.
      volumeStep.value = "7";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      finishRecoveryRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(volumeStep.value).toBe("7");
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(saveSettingsMock.mock.calls.at(-1)?.[0]).toEqual({
        advancedSettings: { volumeStep: 0.07 },
      });
    });

    it("still drops a failed rule edit when another change overtakes the first read", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockReset();
      let finishRecoveryRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRecoveryRead = () => resolve(structuredClone(DEFAULT_SETTINGS));
          }),
      );
      getSettingsMock.mockResolvedValueOnce(structuredClone(DEFAULT_SETTINGS));
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern")!;
      pattern.focus();
      pattern.value = "vimeo.com";
      pattern.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(document.querySelectorAll(".site-policy-row")).toHaveLength(1);

      // An unrelated change event starts a newer read, which finishes first.
      await emitStorageChange();
      finishRecoveryRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(document.querySelectorAll(".site-policy-row")).toHaveLength(0);
    });

    it("reverts a cleared field to the stored value, not the value that failed to save", async () => {
      await loadAdvancedSettingsModule();
      getSettingsMock.mockReset();
      let finishRecoveryRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRecoveryRead = () => resolve(structuredClone(DEFAULT_SETTINGS));
          }),
      );
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      const volumeStep = document.getElementById("volumeStep") as HTMLInputElement;
      volumeStep.focus();
      volumeStep.value = "9";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      volumeStep.dispatchEvent(new Event("blur"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      volumeStep.value = "";
      volumeStep.dispatchEvent(new Event("input", { bubbles: true }));
      finishRecoveryRead();
      await new Promise((resolve) => setTimeout(resolve, 10));
      volumeStep.dispatchEvent(new Event("blur"));

      expect(volumeStep.value).toBe("5");
      expect(saveSettingsMock).toHaveBeenCalledOnce();
    });

    it("drops a failed rule edit but keeps a new row that has not been filled in", async () => {
      const settings = structuredClone(DEFAULT_SETTINGS);
      settings.siteSettings.sitePolicies = [
        { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      ];
      await loadAdvancedSettingsModule(settings);
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));

      const mode = document.querySelector<HTMLSelectElement>(".site-policy-mode")!;
      mode.value = "enabled";
      mode.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(".site-policy-row"));
      expect(rows.map((row) => row.querySelector<HTMLInputElement>("input")!.value)).toEqual([
        "youtube.com",
        "",
      ]);
      expect(rows[0].querySelector<HTMLSelectElement>(".site-policy-mode")!.value).toBe("disabled");
    });

    it("drops a failed rule edit even while the user types in an unrelated field", async () => {
      const settings = structuredClone(DEFAULT_SETTINGS);
      settings.siteSettings.sitePolicies = [
        { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
      ];
      await loadAdvancedSettingsModule(settings);
      saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));
      getSettingsMock.mockReset();
      let finishRecoveryRead!: () => void;
      getSettingsMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRecoveryRead = () => resolve(structuredClone(settings));
          }),
      );

      const mode = document.querySelector<HTMLSelectElement>(".site-policy-mode")!;
      mode.focus();
      mode.value = "enabled";
      mode.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Typing in another field leaves its debounce pending when the recovery read returns.
      const speedStep = document.getElementById("speedStep") as HTMLInputElement;
      speedStep.focus();
      speedStep.value = "0.5";
      speedStep.dispatchEvent(new Event("input", { bubbles: true }));
      finishRecoveryRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(document.querySelector<HTMLSelectElement>(".site-policy-mode")!.value).toBe(
        "disabled",
      );
    });

    it("shows a rule change from elsewhere once focus leaves the rule list", async () => {
      await loadAdvancedSettingsModule();
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern")!;
      pattern.focus();

      await changeElsewhere((settings) => {
        settings.siteSettings.sitePolicies = [
          { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
        ];
      });
      expect(
        Array.from(document.querySelectorAll<HTMLInputElement>(".site-policy-pattern")).map(
          (input) => input.value,
        ),
      ).toEqual([""]);

      pattern.blur();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(
        Array.from(document.querySelectorAll<HTMLInputElement>(".site-policy-pattern")).map(
          (input) => input.value,
        ),
      ).toEqual(["vimeo.com", ""]);
    });

    it("shows site rules changed elsewhere, and saves the next rule edit on top of them", async () => {
      await loadAdvancedSettingsModule();
      expect(document.querySelectorAll(".site-policy-row")).toHaveLength(0);

      await changeElsewhere((settings) => {
        settings.siteSettings.sitePolicies = [
          { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
        ];
      });
      expect(
        Array.from(document.querySelectorAll<HTMLInputElement>(".site-policy-pattern")).map(
          (input) => input.value,
        ),
      ).toEqual(["vimeo.com"]);

      const mode = document.querySelector<HTMLSelectElement>(".site-policy-mode")!;
      mode.value = "enabled";
      mode.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
        siteSettings: {
          sitePolicies: [{ pattern: "vimeo.com", policy: "enabled", embedsPolicy: "inherit" }],
        },
      });
    });

    it("leaves site rule rows alone while one is being edited", async () => {
      await loadAdvancedSettingsModule();
      document
        .getElementById("add-site-policy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const pattern = document.querySelector<HTMLInputElement>(".site-policy-pattern")!;
      pattern.focus();
      pattern.value = "youtu";

      await changeElsewhere((settings) => {
        settings.siteSettings.sitePolicies = [
          { pattern: "vimeo.com", policy: "disabled", embedsPolicy: "inherit" },
        ];
      });

      expect(document.querySelectorAll(".site-policy-row")).toHaveLength(1);
      expect(document.activeElement).toBe(pattern);
      expect(pattern.value).toBe("youtu");
    });
  });
});
