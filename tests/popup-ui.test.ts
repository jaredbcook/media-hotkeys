import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/storage.js";

const { getSettingsMock, saveSettingsMock, openOptionsPageMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn<[], Promise<ExtensionSettings>>(),
  saveSettingsMock: vi.fn(),
  openOptionsPageMock: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      openOptionsPage: openOptionsPageMock,
    },
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>("../src/storage.js");
  return {
    ...actual,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
  };
});

function renderPopupDom(): void {
  document.body.innerHTML = `
    <input id="volumeStep" />
    <input id="speedMin" />
    <input id="speedMax" />
    <input id="speedStep" />
    <input id="seekStepSmall" />
    <input id="seekStepMedium" />
    <input id="seekStepLarge" />
    <input id="sumQuickSkips" type="checkbox" />
    <select id="overlayVisibility"></select>
    <select id="overlayPosition"></select>
    <input id="overlayVisibleDuration" />
    <input id="overlayFadeDuration" />
    <button id="save"></button>
    <button id="reset"></button>
    <button id="more-settings"></button>
    <span id="status"></span>
  `;
}

async function loadPopupModule(settings = structuredClone(DEFAULT_SETTINGS)): Promise<void> {
  vi.resetModules();
  renderPopupDom();
  getSettingsMock.mockResolvedValue(structuredClone(settings));
  saveSettingsMock.mockResolvedValue(undefined);
  openOptionsPageMock.mockResolvedValue(undefined);
  window.close = vi.fn();
  await import("../src/popup.ts");
  await Promise.resolve();
}

beforeEach(() => {
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  openOptionsPageMock.mockReset();
  document.body.innerHTML = "";
});

describe("popup screen", () => {
  it("loads global settings into the form", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.volumeStep = 0.1;
    settings.sumQuickSkips = false;

    await loadPopupModule(settings);

    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe("0.1");
    expect((document.getElementById("sumQuickSkips") as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById("overlayVisibility") as HTMLSelectElement).value).toBe(
      settings.overlayVisibility,
    );
  });

  it("saves edited global settings", async () => {
    await loadPopupModule();

    (document.getElementById("volumeStep") as HTMLInputElement).value = "0.2";
    (document.getElementById("sumQuickSkips") as HTMLInputElement).checked = false;
    document.getElementById("save")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      volumeStep: 0.2,
      sumQuickSkips: false,
    });
    expect(document.getElementById("status")?.classList.contains("visible")).toBe(true);
  });

  it("resets only global settings to defaults", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.volumeStep = 0.2;
    settings.actions.togglePlayPause.keys = ["x"];

    await loadPopupModule(settings);

    document.getElementById("reset")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      volumeStep: DEFAULT_SETTINGS.volumeStep,
      sumQuickSkips: DEFAULT_SETTINGS.sumQuickSkips,
      actions: { togglePlayPause: { keys: ["x"] } },
    });
    expect((document.getElementById("volumeStep") as HTMLInputElement).value).toBe(
      String(DEFAULT_SETTINGS.volumeStep),
    );
  });

  it("opens the full options screen from the More Settings button", async () => {
    await loadPopupModule();

    document.getElementById("more-settings")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openOptionsPageMock).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
  });
});
