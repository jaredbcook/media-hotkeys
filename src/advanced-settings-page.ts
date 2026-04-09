import { collectAdvancedSettings, populateAdvancedSettings } from "./advanced-settings.js";
import {
  DEFAULT_ADVANCED_SETTINGS,
  getSettings,
  saveSettings,
  type ExtensionSettings,
} from "./storage.js";

let currentSettings: ExtensionSettings;
let pendingSave: Promise<void> = Promise.resolve();

function showStatus(): void {
  const status = document.getElementById("status");
  if (!status) {
    return;
  }

  status.textContent = "Settings saved.";
  status.classList.add("visible");
  window.setTimeout(() => status.classList.remove("visible"), 2000);
}

function persistSettings(): Promise<void> {
  currentSettings.advancedSettings = collectAdvancedSettings();

  const nextSettings = structuredClone(currentSettings);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await saveSettings(nextSettings);
      showStatus();
    });

  return pendingSave;
}

async function handleReset(): Promise<void> {
  currentSettings.advancedSettings = structuredClone(DEFAULT_ADVANCED_SETTINGS);
  populateAdvancedSettings(currentSettings.advancedSettings);
  await persistSettings();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateAdvancedSettings(currentSettings.advancedSettings);

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
        void persistSettings();
      });
    }
  }

  document.getElementById("reset")?.addEventListener("click", () => {
    void handleReset();
  });
}

void init();
