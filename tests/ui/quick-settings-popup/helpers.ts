import { expect, vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

const hoistedMocks = vi.hoisted(() => ({
  getSettingsMock: vi.fn<[], Promise<ExtensionSettings>>(),
  saveSettingsMock: vi.fn(),
  openOptionsPageMock: vi.fn(),
}));

export const getSettingsMock = hoistedMocks.getSettingsMock;
export const saveSettingsMock = hoistedMocks.saveSettingsMock;
export const openOptionsPageMock = hoistedMocks.openOptionsPageMock;
const DEFAULT_SETTINGS = defaults as ExtensionSettings;

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

vi.mock("../../../src/storage.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/storage.js")>("../../../src/storage.js");
  return {
    ...actual,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
  };
});

export function renderQuickSettingsDom(): void {
  document.body.innerHTML = `
    <input id="hotkeysEnabled" type="checkbox" />
    <table><tbody id="actions-body"></tbody></table>
    <div id="announcements"></div>
    <div id="announcement-live-region" class="screen-reader" aria-live="polite" aria-atomic="true"></div>
    <button id="reset"></button>
    <button id="advanced-settings"></button>
  `;
}

export function resetQuickSettingsTestState(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  openOptionsPageMock.mockReset();
  document.body.innerHTML = "";
}

export async function loadQuickSettingsModule(
  settings = structuredClone(DEFAULT_SETTINGS),
): Promise<void> {
  vi.resetModules();
  renderQuickSettingsDom();
  getSettingsMock.mockResolvedValue(structuredClone(settings));
  saveSettingsMock.mockResolvedValue(undefined);
  openOptionsPageMock.mockResolvedValue(undefined);
  window.close = vi.fn();
  await import("../../../src/quick-settings-popup.js");
  await Promise.resolve();
}

export async function flushDomWork(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function findRowByLabel(label: string): HTMLTableRowElement {
  const rows = Array.from(document.querySelectorAll("#actions-body tr"));
  const row = rows.find((candidate) => candidate.firstElementChild?.textContent === label);
  expect(row).toBeTruthy();
  return row as HTMLTableRowElement;
}
