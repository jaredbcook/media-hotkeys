import browser from "webextension-polyfill";
import defaults from "./settings/defaults.json";

// #region Types

export type MediaAction =
  | "togglePlayPause"
  | "toggleMute"
  | "toggleOverlays"
  | "toggleFullscreen"
  | "togglePip"
  | "speedUp"
  | "slowDown"
  | "volumeUp"
  | "volumeDown"
  | "seekForwardSmall"
  | "seekBackwardSmall"
  | "seekForwardMedium"
  | "seekBackwardMedium"
  | "seekForwardLarge"
  | "seekBackwardLarge"
  | "restart"
  | "seekToPercent0"
  | "seekToPercent10"
  | "seekToPercent20"
  | "seekToPercent30"
  | "seekToPercent40"
  | "seekToPercent50"
  | "seekToPercent60"
  | "seekToPercent70"
  | "seekToPercent80"
  | "seekToPercent90";

export type ConfigurableMediaAction = Exclude<
  MediaAction,
  | "seekToPercent0"
  | "seekToPercent10"
  | "seekToPercent20"
  | "seekToPercent30"
  | "seekToPercent40"
  | "seekToPercent50"
  | "seekToPercent60"
  | "seekToPercent70"
  | "seekToPercent80"
  | "seekToPercent90"
>;

export type OverlayPosition =
  | "top-left"
  | "top"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export type SkipOverlayPosition = "left / right" | "same as others";

export interface ActionConfig {
  keys: string[];
}

export interface QuickSettings {
  hotkeysEnabled: boolean;
  actionKeyBindings: Record<ConfigurableMediaAction, ActionConfig>;
}

export interface AdvancedSettings {
  volumeStep: number;
  speedMin: number;
  speedMax: number;
  speedStep: number;
  seekStepSmall: number;
  seekStepMedium: number;
  seekStepLarge: number;
  useNumberKeysToJump: boolean;
  sumQuickSkips: boolean;
  showOverlays: boolean;
  overlayPosition: OverlayPosition;
  skipOverlayPosition: SkipOverlayPosition;
  overlayVisibleDuration: number;
  overlayFadeDuration: number;
  debugLogging: boolean;
}

export interface ExtensionSettings {
  quickSettings: QuickSettings;
  advancedSettings: AdvancedSettings;
}

export interface SettingsUpdate extends Partial<AdvancedSettings> {
  quickSettings?: {
    hotkeysEnabled?: boolean;
    actionKeyBindings?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  };
  advancedSettings?: Partial<AdvancedSettings>;
  actions?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  hotkeysEnabled?: boolean;
  globalSettings?: Partial<AdvancedSettings>;
}

const NON_OVERLAY_ACTIONS = new Set<MediaAction>(["toggleFullscreen", "togglePip"]);

// #endregion

// #region Defaults

export const DEFAULT_SETTINGS: ExtensionSettings = defaults as ExtensionSettings;
export const DEFAULT_QUICK_SETTINGS: QuickSettings = DEFAULT_SETTINGS.quickSettings;
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = DEFAULT_SETTINGS.advancedSettings;

export function actionSupportsOverlay(action: MediaAction): boolean {
  return !NON_OVERLAY_ACTIONS.has(action);
}

function isDirectionalSkipAction(
  action: MediaAction,
): action is
  | "seekForwardSmall"
  | "seekBackwardSmall"
  | "seekForwardMedium"
  | "seekBackwardMedium"
  | "seekForwardLarge"
  | "seekBackwardLarge" {
  return action.startsWith("seekForward") || action.startsWith("seekBackward");
}

function mergeActionKeyBindings(
  storedBindings?: Partial<Record<ConfigurableMediaAction, Partial<ActionConfig>>>,
  legacyBindings?: Partial<Record<ConfigurableMediaAction, Partial<ActionConfig>>>,
): Record<ConfigurableMediaAction, ActionConfig> {
  const normalizedBindings = {} as Record<ConfigurableMediaAction, ActionConfig>;

  for (const action of Object.keys(
    DEFAULT_QUICK_SETTINGS.actionKeyBindings,
  ) as ConfigurableMediaAction[]) {
    normalizedBindings[action] = {
      ...DEFAULT_QUICK_SETTINGS.actionKeyBindings[action],
      ...legacyBindings?.[action],
      ...storedBindings?.[action],
    };
  }

  return normalizedBindings;
}

function normalizeSettings(
  settings: Partial<ExtensionSettings> & SettingsUpdate,
): ExtensionSettings {
  const nestedQuickSettings: Partial<QuickSettings> & {
    actionKeyBindings?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  } = settings.quickSettings ?? {};
  const nestedAdvancedSettings: Partial<AdvancedSettings> = settings.advancedSettings ?? {};
  const legacyGlobalSettings = settings.globalSettings ?? {};

  const quickSettings: QuickSettings = {
    ...DEFAULT_QUICK_SETTINGS,
    ...nestedQuickSettings,
    hotkeysEnabled:
      nestedQuickSettings.hotkeysEnabled ??
      settings.hotkeysEnabled ??
      DEFAULT_QUICK_SETTINGS.hotkeysEnabled,
    actionKeyBindings: mergeActionKeyBindings(
      nestedQuickSettings.actionKeyBindings,
      settings.actions,
    ),
  };

  const advancedSettings: AdvancedSettings = {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...settings,
    ...legacyGlobalSettings,
    ...nestedAdvancedSettings,
  };

  return {
    quickSettings,
    advancedSettings,
  };
}

function mergeSettings(
  baseSettings: ExtensionSettings,
  settingsUpdate: SettingsUpdate,
): ExtensionSettings {
  return normalizeSettings({
    ...baseSettings,
    ...settingsUpdate,
    quickSettings: {
      ...baseSettings.quickSettings,
      ...settingsUpdate.quickSettings,
      hotkeysEnabled:
        settingsUpdate.quickSettings?.hotkeysEnabled ??
        settingsUpdate.hotkeysEnabled ??
        baseSettings.quickSettings.hotkeysEnabled,
      actionKeyBindings: mergeActionKeyBindings(
        settingsUpdate.quickSettings?.actionKeyBindings,
        settingsUpdate.actions,
      ),
    },
    advancedSettings: {
      ...baseSettings.advancedSettings,
      ...settingsUpdate,
      ...settingsUpdate.globalSettings,
      ...settingsUpdate.advancedSettings,
    },
  });
}

export function resolveActionOverlaySettings(
  action: MediaAction,
  _actionConfig: ActionConfig,
  advancedSettings: AdvancedSettings,
): { overlayVisible: boolean; overlayPosition: OverlayPosition } {
  if (!actionSupportsOverlay(action)) {
    return {
      overlayVisible: false,
      overlayPosition: advancedSettings.overlayPosition,
    };
  }

  if (action === "toggleOverlays") {
    return {
      overlayVisible: true,
      overlayPosition: advancedSettings.overlayPosition,
    };
  }

  if (!advancedSettings.showOverlays) {
    return {
      overlayVisible: false,
      overlayPosition: advancedSettings.overlayPosition,
    };
  }

  if (isDirectionalSkipAction(action) && advancedSettings.skipOverlayPosition === "left / right") {
    return {
      overlayVisible: true,
      overlayPosition: action.startsWith("seekForward") ? "center-right" : "center-left",
    };
  }

  return {
    overlayVisible: true,
    overlayPosition: advancedSettings.overlayPosition,
  };
}

// #endregion

// #region Storage

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.sync.get({});
  return normalizeSettings(result as Partial<ExtensionSettings> & SettingsUpdate);
}

export async function saveSettings(settingsUpdate: SettingsUpdate): Promise<void> {
  const currentSettings = await getSettings();
  const mergedSettings = mergeSettings(currentSettings, settingsUpdate);
  await browser.storage.sync.set(mergedSettings as unknown as Record<string, unknown>);
}

// #endregion

// #region Utilities

export function normalizeHotkeyKey(key: string): string {
  return /^[a-z]$/i.test(key) ? key.toLowerCase() : key;
}

export function buildKeyToActionMap(
  actionKeyBindings: Record<ConfigurableMediaAction, ActionConfig>,
): Map<string, ConfigurableMediaAction> {
  const map = new Map<string, ConfigurableMediaAction>();
  for (const [action, config] of Object.entries(actionKeyBindings)) {
    for (const key of config.keys) {
      map.set(normalizeHotkeyKey(key), action as ConfigurableMediaAction);
    }
  }
  return map;
}

// #endregion
