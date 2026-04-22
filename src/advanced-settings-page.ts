import { collectAdvancedSettings, populateAdvancedSettings } from "./advanced-settings.js";
import {
  DEFAULT_ADVANCED_SETTINGS,
  getSettings,
  saveSettings,
  settingsEqual,
  type ExtensionSettings,
} from "./storage.js";
import { showStatusToast } from "./status-toast.js";

let currentSettings: ExtensionSettings;
let pendingSave: Promise<void> = Promise.resolve();
let debouncedInputSaveId: number | undefined;

const INPUT_SAVE_DEBOUNCE_MS = 500;

function showStatus(): void {
  showStatusToast("Settings saved.", "success");
}

function persistSettings(nextSettings?: ExtensionSettings): Promise<void> {
  if (!normalizeEditableInputsForSave()) {
    return pendingSave;
  }

  const settingsToPersist = nextSettings ?? {
    ...currentSettings,
    advancedSettings: collectAdvancedSettings(),
  };

  if (settingsEqual(currentSettings, settingsToPersist)) {
    return pendingSave;
  }

  currentSettings = settingsToPersist;
  const settingsToSave = structuredClone(settingsToPersist);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await saveSettings(settingsToSave);
      showStatus();
    });

  return pendingSave;
}

function isDebouncedTextInput(input: HTMLInputElement): boolean {
  return input.type === "number" || input.type === "text";
}

function getEditableInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
    isDebouncedTextInput,
  );
}

function rememberValidInputValue(input: HTMLInputElement): void {
  input.dataset.lastValidValue = input.value;
}

function revertToLastValidInputValue(input: HTMLInputElement): void {
  input.value = input.dataset.lastValidValue ?? input.defaultValue;
}

function getClampedNumberInputValue(input: HTMLInputElement): string | undefined {
  if (input.value.trim() === "") {
    return undefined;
  }

  const parsedValue = input.valueAsNumber;
  if (Number.isNaN(parsedValue)) {
    return undefined;
  }

  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  const clampedValue = Math.min(Math.max(parsedValue, min), max);

  return String(clampedValue);
}

function normalizeEditableInput(input: HTMLInputElement): boolean {
  if (input.value.trim() === "") {
    return false;
  }

  if (input.type === "number") {
    const clampedValue = getClampedNumberInputValue(input);
    if (clampedValue === undefined) {
      return false;
    }

    input.value = clampedValue;
  }

  rememberValidInputValue(input);
  return true;
}

function normalizeEditableInputsForSave(): boolean {
  return getEditableInputs().every((input) => normalizeEditableInput(input));
}

function clearDebouncedInputSave(): void {
  if (debouncedInputSaveId === undefined) {
    return;
  }

  window.clearTimeout(debouncedInputSaveId);
  debouncedInputSaveId = undefined;
}

function scheduleDebouncedInputSave(): void {
  clearDebouncedInputSave();
  debouncedInputSaveId = window.setTimeout(() => {
    debouncedInputSaveId = undefined;
    void persistSettings();
  }, INPUT_SAVE_DEBOUNCE_MS);
}

function handleEditableInput(input: HTMLInputElement): void {
  if (input.value.trim() === "") {
    clearDebouncedInputSave();
    return;
  }

  scheduleDebouncedInputSave();
}

function handleEditableInputBlur(input: HTMLInputElement): void {
  clearDebouncedInputSave();

  if (!normalizeEditableInput(input)) {
    revertToLastValidInputValue(input);
    return;
  }

  void persistSettings();
}

async function handleReset(): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.advancedSettings = structuredClone(DEFAULT_ADVANCED_SETTINGS);
  populateAdvancedSettings(nextSettings.advancedSettings);
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }
  await persistSettings(nextSettings);
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateAdvancedSettings(currentSettings.advancedSettings);
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }

  for (const selector of ["input", "select"]) {
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      selector,
    )) {
      if (element instanceof HTMLInputElement && isDebouncedTextInput(element)) {
        element.addEventListener("input", () => {
          handleEditableInput(element);
        });
        element.addEventListener("blur", () => {
          handleEditableInputBlur(element);
        });
        continue;
      }

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
