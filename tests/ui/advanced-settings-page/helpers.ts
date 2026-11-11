import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

const hoistedMocks = vi.hoisted(() => ({
  getSettingsMock: vi.fn<() => Promise<ExtensionSettings>>(),
  saveSettingsMock: vi.fn(),
  storageChangeListeners: [] as ((changes: unknown, areaName: string) => void)[],
}));

export const getSettingsMock = hoistedMocks.getSettingsMock;
export const saveSettingsMock = hoistedMocks.saveSettingsMock;
const storageChangeListeners = hoistedMocks.storageChangeListeners;
const DEFAULT_SETTINGS = defaults as ExtensionSettings;

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getManifest: () => ({ version: "1.2.3" }),
    },
    storage: {
      onChanged: {
        addListener: (listener: (changes: unknown, areaName: string) => void) => {
          hoistedMocks.storageChangeListeners.push(listener);
        },
      },
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

/** The number inputs of the shipped page, so tests run against its real limits rather than a copy. */
export function readShippedNumberInputs(): HTMLInputElement[] {
  const html = readFileSync(
    path.resolve(__dirname, "../../../src/advanced-settings-page.html"),
    "utf8",
  );
  const page = new DOMParser().parseFromString(html, "text/html");
  return Array.from(page.querySelectorAll<HTMLInputElement>('input[type="number"]'));
}

export function renderAdvancedSettingsDom(): void {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = `
    <h1>Media Hotkeys <span id="extension-version"></span></h1>
    <a id="report-issue-link" href="https://github.com/jaredbcook/media-hotkeys/issues/new"></a>
    ${readShippedNumberInputs()
      .map((input) => input.outerHTML)
      .join("\n")}
    <input id="useNumberKeysToJump" type="checkbox" />
    <input id="sumQuickSkips" type="checkbox" />
    <input id="showOverlays" type="checkbox" />
    <select id="overlayPosition"></select>
    <select id="skipOverlayPosition"></select>
    <input id="debugLogging" type="checkbox" />
    <section id="site-policies-section">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>Page Policy</th>
            <th>Embeds Policy</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="site-policies-list"></tbody>
      </table>
      <div id="site-policies-error" aria-live="polite"></div>
      <button id="add-site-policy" type="button"></button>
    </section>
    <button id="reset"></button>
    <div id="announcements" aria-live="polite" aria-atomic="true"></div>
  `;
}

export function resetAdvancedSettingsTestState(): void {
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  storageChangeListeners.length = 0;
  document.body.innerHTML = "";
}

export async function loadAdvancedSettingsModule(
  settings = structuredClone(DEFAULT_SETTINGS),
  search = "",
): Promise<void> {
  vi.resetModules();
  renderAdvancedSettingsDom();
  window.history.pushState({}, "", `/${search}`);
  getSettingsMock.mockResolvedValue(structuredClone(settings));
  saveSettingsMock.mockResolvedValue(undefined);
  await import("../../../src/advanced-settings-page.js");
  await Promise.resolve();
}

/** Announces a storage change, as the browser does after another surface saved, and lets the page react. */
export async function emitStorageChange(areaName = "sync"): Promise<void> {
  for (const listener of storageChangeListeners) {
    listener({}, areaName);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}
