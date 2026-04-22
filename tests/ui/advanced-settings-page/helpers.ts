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
    <input type="number" id="volumeStep" min="1" max="10" step="1" />
    <input type="number" id="speedMin" min="0.1" max="1" step="0.05" />
    <input type="number" id="speedMax" min="1" max="8" step="0.25" />
    <input type="number" id="speedStep" min="0.05" max="1" step="0.05" />
    <input type="number" id="seekStepSmall" min="1" max="15" step="1" />
    <input type="number" id="seekStepMedium" min="2" max="30" step="1" />
    <input type="number" id="seekStepLarge" min="3" max="60" step="1" />
    <input id="useNumberKeysToJump" type="checkbox" />
    <input id="sumQuickSkips" type="checkbox" />
    <input id="showOverlays" type="checkbox" />
    <select id="overlayPosition"></select>
    <select id="skipOverlayPosition"></select>
    <input type="number" id="overlayVisibleDuration" min="0" max="1000" step="50" />
    <input type="number" id="overlayFadeDuration" min="0" max="2000" step="50" />
    <input id="debugLogging" type="checkbox" />
    <button id="reset"></button>
    <div id="announcements" aria-live="polite" aria-atomic="true"></div>
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
