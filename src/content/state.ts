import {
  type ExtensionSettings,
  type MediaAction,
  DEFAULT_SETTINGS,
  buildKeyToActionMap,
} from "../storage.js";

type ContentState = {
  settings: ExtensionSettings;
  keyToActionMap: Map<string, MediaAction>;
  lastInteractedMedia: HTMLMediaElement | null;
  lastActionedMedia: HTMLMediaElement | null;
};

// Mutable state shared across content-script modules. State touched by only
// one module stays private to that module instead of living here.
export const state: ContentState = {
  settings: DEFAULT_SETTINGS,
  keyToActionMap: buildKeyToActionMap(DEFAULT_SETTINGS.quickSettings.actionKeyBindings),
  lastInteractedMedia: null,
  lastActionedMedia: null,
};

export const actionedMedia = new WeakSet<HTMLMediaElement>();
