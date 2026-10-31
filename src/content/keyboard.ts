import { type MediaAction, normalizeHotkeyKey } from "../storage.js";
import { isGlobalAction } from "./actions.js";
import { dispatchMediaAction, handleGlobalAction } from "./dispatch.js";
import { debugLog, isControlValueKey, isWithinEditableElement } from "./dom-utils.js";
import { isSiteDisabledByPolicy } from "./frame-messaging.js";
import { hasPotentialTarget } from "./media-presence.js";
import { state } from "./state.js";
import { exitTheater } from "./theater.js";

const NUMBER_KEY_ACTIONS: Record<string, MediaAction> = {
  "0": "seekToPercent0",
  "1": "seekToPercent10",
  "2": "seekToPercent20",
  "3": "seekToPercent30",
  "4": "seekToPercent40",
  "5": "seekToPercent50",
  "6": "seekToPercent60",
  "7": "seekToPercent70",
  "8": "seekToPercent80",
  "9": "seekToPercent90",
};

function isEditableKeyEvent(e: KeyboardEvent): boolean {
  if (document.activeElement && isWithinEditableElement(document.activeElement)) {
    return true;
  }

  if (e.target instanceof Element && isWithinEditableElement(e.target)) {
    return true;
  }

  return e.composedPath().some((target) => {
    return target instanceof Element && isWithinEditableElement(target);
  });
}

function getKeyString(e: KeyboardEvent): string {
  return normalizeHotkeyKey(e.key);
}

function getActionForKey(key: string): MediaAction | undefined {
  const action = state.keyToActionMap.get(key);
  if (action) {
    return action;
  }

  if (state.settings.advancedSettings.useNumberKeysToJump) {
    return NUMBER_KEY_ACTIONS[key];
  }

  return undefined;
}

// Holding a key repeats only actions that step a value. Repeating a toggle
// would flip it back and forth, such as fullscreen on and off.
function isRepeatableAction(action: MediaAction): boolean {
  return (
    action.startsWith("seekForward") ||
    action.startsWith("seekBackward") ||
    action === "volumeUp" ||
    action === "volumeDown" ||
    action === "speedUp" ||
    action === "slowDown"
  );
}

// Layouts such as German and French type characters like `[` and `]` with
// AltGr, which Windows reports as Ctrl+Alt. Those keys are plain characters,
// not shortcuts.
function hasReservedModifier(e: KeyboardEvent): boolean {
  if (e.metaKey) return true;
  if (e.getModifierState("AltGraph")) return false;
  return e.altKey || e.ctrlKey;
}

export async function handleKeyDown(e: KeyboardEvent): Promise<void> {
  // Leaving theater mode must keep working even if hotkeys were disabled or
  // focus landed in an editable element after the video was promoted.
  if (e.key === "Escape" && !hasReservedModifier(e) && exitTheater()) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (!state.settings.quickSettings.hotkeysEnabled) return;
  if (isSiteDisabledByPolicy()) return;
  if (isEditableKeyEvent(e)) return;
  if (hasReservedModifier(e)) return;

  const key = getKeyString(e);
  const keyTarget = e.composedPath()[0];
  if (isControlValueKey(keyTarget, key)) return;

  const action = getActionForKey(key);
  if (!action) return;

  // Only take the key from the page when it can do something. Otherwise pages
  // without media would lose scrolling and their own shortcuts to our bindings.
  if (!hasPotentialTarget(action, key, keyTarget instanceof Element ? keyTarget : null)) {
    debugLog("No media for action; leaving the key to the page", undefined, { action, key });
    return;
  }

  debugLog("Matched keydown to action", undefined, { action, key });

  e.preventDefault();
  e.stopPropagation();

  if (e.repeat && !isRepeatableAction(action)) {
    return;
  }

  if (isGlobalAction(action)) {
    await handleGlobalAction(action);
    return;
  }

  if (!(await dispatchMediaAction(action))) {
    debugLog("No media element found for action", undefined, { action, key });
  }
}
