import browser from "webextension-polyfill";
import type { MediaAction } from "./storage.js";
import { handleFrameMessage } from "./content/dispatch.js";
import { handleFullscreenChange } from "./content/fullscreen.js";
import { handleKeyDown } from "./content/keyboard.js";
import { initializeDynamicMediaTracking } from "./content/media-tracking.js";
import { handleStorageChanged, loadSettings } from "./content/settings-sync.js";

export type { MediaAction };
export { handleAction } from "./content/actions.js";
export { delegateActionToChildFrames } from "./content/frame-messaging.js";
export { getBestLocalCandidate, getTargetMedia } from "./content/media-scoring.js";
export { setSettingsForTests } from "./content/settings-sync.js";

window.addEventListener("message", handleFrameMessage);
browser.storage.onChanged.addListener(handleStorageChanged);
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("keydown", handleKeyDown, true);
initializeDynamicMediaTracking();
void loadSettings();
