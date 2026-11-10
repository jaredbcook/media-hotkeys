import {
  type ExtensionSettings,
  buildKeyToActionMap,
  getSettings,
  saveSettings,
} from "../storage.js";
import { refreshTopLevelSitePolicy } from "./frame-messaging.js";
import { state } from "./state.js";

// The overlay toggle flips `showOverlays` here before its save lands. Until
// this frame's saves have settled, the value it chose wins over what a reload
// reads back, so a reload between two quick toggles can't undo the second.
let pendingShowOverlays: boolean | null = null;
let pendingOverlaySaveCount = 0;
let overlaySaveQueue: Promise<void> = Promise.resolve();

// Reloads can overlap. Only the newest read is applied, so an older one that
// finishes late can't put back what it saw.
let latestLoadNumber = 0;

export async function loadSettings(): Promise<void> {
  latestLoadNumber += 1;
  const loadNumber = latestLoadNumber;
  try {
    const settings = await getSettings();
    if (loadNumber !== latestLoadNumber) {
      return;
    }
    if (pendingShowOverlays !== null) {
      settings.advancedSettings.showOverlays = pendingShowOverlays;
    }
    state.settings = settings;
    state.keyToActionMap = buildKeyToActionMap(state.settings.quickSettings.actionKeyBindings);
    refreshTopLevelSitePolicy();
  } catch {
    // Keep defaults on failure
  }
}

/**
 * Flips `showOverlays` in this frame and saves it, and returns the new value.
 * Only the frame that received the keypress calls this, so each toggle is one
 * write however many frames the page has. Other frames reload the setting on
 * `storage.onChanged`. Saves run one at a time, in keypress order.
 */
export function toggleOverlayVisibility(): boolean {
  const showOverlays = !state.settings.advancedSettings.showOverlays;
  state.settings.advancedSettings.showOverlays = showOverlays;
  pendingShowOverlays = showOverlays;
  pendingOverlaySaveCount += 1;

  overlaySaveQueue = overlaySaveQueue
    .then(() => saveSettings({ advancedSettings: { showOverlays } }))
    .catch(() => {
      // The reload below puts back what is stored.
    })
    .then(() => {
      pendingOverlaySaveCount -= 1;
      if (pendingOverlaySaveCount > 0) {
        return;
      }

      // Read back what is stored. A failed write announces nothing, and a
      // change from elsewhere that reloaded while the saves were pending was
      // masked by the pending value.
      pendingShowOverlays = null;
      void loadSettings();
    });

  return showOverlays;
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
