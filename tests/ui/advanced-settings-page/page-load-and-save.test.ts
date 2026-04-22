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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      siteSettings: {
        sitePolicies: [
          { pattern: "vimeo.com", policy: "enabled", embedsPolicy: "ignore" },
          { pattern: "youtube.com/shorts", policy: "disabled", embedsPolicy: "inherit" },
        ],
        disabledUrlPatterns: ["youtube.com/shorts"],
      },
    });
    expect(youtubePattern!.value).toBe("youtube.com/shorts");
  });

  it("saves site policy dropdown changes immediately", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["youtube.com"];
    await loadAdvancedSettingsModule(settings);

    const mode = document.querySelector<HTMLSelectElement>(".site-policy-mode");
    const embedsPolicy = document.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    expect(mode).toBeTruthy();
    expect(embedsPolicy).toBeTruthy();

    mode!.value = "enabled";
    mode!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "enabled", embedsPolicy: "inherit" }],
        disabledUrlPatterns: [],
      },
    });

    embedsPolicy!.value = "ignore";
    embedsPolicy!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledTimes(2);
    expect(saveSettingsMock.mock.calls[1]?.[0]).toMatchObject({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "enabled", embedsPolicy: "ignore" }],
        disabledUrlPatterns: [],
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
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      siteSettings: {
        sitePolicies: [{ pattern: "youtube.com", policy: "disabled", embedsPolicy: "inherit" }],
        disabledUrlPatterns: ["youtube.com"],
      },
    });
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
    settings.siteSettings.disabledUrlPatterns = ["youtube.com"];
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
});
