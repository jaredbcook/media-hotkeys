import { type ExtensionSettings, buildKeyToActionMap, getSettings } from "../storage.js";
import { refreshTopLevelSitePolicy } from "./frame-messaging.js";
import { state } from "./state.js";

export async function loadSettings(): Promise<void> {
  try {
    state.settings = await getSettings();
    state.keyToActionMap = buildKeyToActionMap(state.settings.quickSettings.actionKeyBindings);
    refreshTopLevelSitePolicy();
  } catch {
    // Keep defaults on failure
  }
}

export function handleStorageChanged(_changes: unknown, areaName: string): void {
  if (areaName !== "sync") {
    return;
  }

  void loadSettings();
}

export function setSettingsForTests(nextSettings: ExtensionSettings): void {
  state.settings = nextSettings;
  state.keyToActionMap = buildKeyToActionMap(state.settings.quickSettings.actionKeyBindings);
  refreshTopLevelSitePolicy();
}
