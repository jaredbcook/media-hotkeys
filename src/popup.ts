import browser from "webextension-polyfill";
import { collectGlobalSettings, populateGlobalSettings } from "./global-settings.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type ExtensionSettings } from "./storage.js";

let currentSettings: ExtensionSettings;
let pendingSave: Promise<void> = Promise.resolve();
let statusTimeoutId: number | undefined;

function showStatus(): void {
  const status = document.getElementById("status");
  if (!status) {
    return;
  }

  if (statusTimeoutId !== undefined) {
    window.clearTimeout(statusTimeoutId);
  }

  status?.classList.add("visible");
  statusTimeoutId = window.setTimeout(() => {
    status.classList.remove("visible");
    statusTimeoutId = undefined;
  }, 2000);
}

function persistSettings(): Promise<void> {
  Object.assign(currentSettings, collectGlobalSettings());
  const nextSettings = structuredClone(currentSettings);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await saveSettings(nextSettings);
      showStatus();
    });

  return pendingSave;
}

async function handleSettingsInput(): Promise<void> {
  await persistSettings();
}

async function handleReset(): Promise<void> {
  Object.assign(currentSettings, {
    volumeStep: DEFAULT_SETTINGS.volumeStep,
    speedMin: DEFAULT_SETTINGS.speedMin,
    speedMax: DEFAULT_SETTINGS.speedMax,
    speedStep: DEFAULT_SETTINGS.speedStep,
    seekStepSmall: DEFAULT_SETTINGS.seekStepSmall,
    seekStepMedium: DEFAULT_SETTINGS.seekStepMedium,
    seekStepLarge: DEFAULT_SETTINGS.seekStepLarge,
    sumQuickSkips: DEFAULT_SETTINGS.sumQuickSkips,
    overlayVisibility: DEFAULT_SETTINGS.overlayVisibility,
    overlayPosition: DEFAULT_SETTINGS.overlayPosition,
    overlayVisibleDuration: DEFAULT_SETTINGS.overlayVisibleDuration,
    overlayFadeDuration: DEFAULT_SETTINGS.overlayFadeDuration,
  });
  populateGlobalSettings(currentSettings);
  await persistSettings();
}

async function handleMoreSettings(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateGlobalSettings(currentSettings);

  for (const selector of ["input", "select"]) {
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      selector,
    )) {
      const eventName =
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
          ? "change"
          : "input";
      element.addEventListener(eventName, () => {
        void handleSettingsInput();
      });
    }
  }
  document.getElementById("reset")?.addEventListener("click", handleReset);
  document.getElementById("more-settings")?.addEventListener("click", () => {
    void handleMoreSettings();
  });
}

void init();
