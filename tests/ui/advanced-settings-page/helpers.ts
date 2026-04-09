import { vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

const hoistedMocks = vi.hoisted(() => ({
  getSettingsMock: vi.fn<[], Promise<ExtensionSettings>>(),
  saveSettingsMock: vi.fn(),
}));

export const getSettingsMock = hoistedMocks.getSettingsMock;
export const saveSettingsMock = hoistedMocks.saveSettingsMock;
const DEFAULT_SETTINGS = defaults as ExtensionSettings;

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

vi.mock("../../../src/storage.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/storage.js")>("../../../src/storage.js");
  return {
    ...actual,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
  };
});

export function renderAdvancedSettingsDom(): void {
  document.body.innerHTML = `
    <input id="volumeStep" />
    <input id="speedMin" />
    <input id="speedMax" />
    <input id="speedStep" />
    <input id="seekStepSmall" />
    <input id="seekStepMedium" />
    <input id="seekStepLarge" />
    <input id="useNumberKeysToJump" type="checkbox" />
    <input id="sumQuickSkips" type="checkbox" />
    <input id="showOverlays" type="checkbox" />
    <select id="overlayPosition"></select>
    <select id="skipOverlayPosition"></select>
    <input id="overlayVisibleDuration" />
    <input id="overlayFadeDuration" />
    <input id="debugLogging" type="checkbox" />
    <button id="reset"></button>
    <span id="status"></span>
  `;
}

export function resetAdvancedSettingsTestState(): void {
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  document.body.innerHTML = "";
}

export async function loadAdvancedSettingsModule(
  settings = structuredClone(DEFAULT_SETTINGS),
): Promise<void> {
  vi.resetModules();
  renderAdvancedSettingsDom();
  getSettingsMock.mockResolvedValue(structuredClone(settings));
  saveSettingsMock.mockResolvedValue(undefined);
  await import("../../../src/advanced-settings-page.js");
  await Promise.resolve();
}
