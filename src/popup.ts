import browser from "webextension-polyfill";
import { collectGlobalSettings, populateGlobalSettings } from "./global-settings.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings, type ExtensionSettings } from "./storage.js";

let currentSettings: ExtensionSettings;

function showStatus(): void {
  const status = document.getElementById("status");
  status?.classList.add("visible");
  setTimeout(() => status?.classList.remove("visible"), 2000);
}

async function handleSave(): Promise<void> {
  Object.assign(currentSettings, collectGlobalSettings());
  await saveSettings(currentSettings);
  showStatus();
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
  await saveSettings(currentSettings);
  showStatus();
}

async function handleMoreSettings(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateGlobalSettings(currentSettings);

  document.getElementById("save")?.addEventListener("click", handleSave);
  document.getElementById("reset")?.addEventListener("click", handleReset);
  document.getElementById("more-settings")?.addEventListener("click", () => {
    void handleMoreSettings();
  });
}

void init();
