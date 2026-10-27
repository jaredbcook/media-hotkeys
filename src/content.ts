import browser from "webextension-polyfill";
import type { MediaAction } from "./storage.js";
import { handleFrameMessage } from "./content/dispatch.js";
import { handleFullscreenChange } from "./content/fullscreen.js";
import { handleKeyDown } from "./content/keyboard.js";
import {
  handleDocumentMouseOut,
  handleDocumentPointerDown,
  handleDocumentPointerMove,
  initializeDynamicMediaTracking,
} from "./content/media-tracking.js";
import { initializeMediaPresence } from "./content/media-presence.js";
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
document.addEventListener("pointerdown", handleDocumentPointerDown, {
  capture: true,
  passive: true,
});
document.addEventListener("pointermove", handleDocumentPointerMove, {
  capture: true,
  passive: true,
});
document.addEventListener("mouseout", handleDocumentMouseOut, { capture: true, passive: true });
initializeDynamicMediaTracking();
initializeMediaPresence();
void loadSettings();
