import browser from "webextension-polyfill";
import defaults from "./settings/defaults.json";

// #region Types

export type MediaAction =
  | "togglePlayPause"
  | "toggleMute"
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

export type OverlayVisibility = "All" | "None" | "Custom";

export interface ActionConfig {
  keys: string[];
  overlayVisible?: boolean;
  overlayPosition?: OverlayPosition;
}

export interface GlobalSettings {
  volumeStep: number;
  speedMin: number;
  speedMax: number;
  speedStep: number;
  seekStepSmall: number;
  seekStepMedium: number;
  seekStepLarge: number;
  sumQuickSkips: boolean;
  overlayVisibility: OverlayVisibility;
  overlayPosition: OverlayPosition;
  overlayVisibleDuration: number;
  overlayFadeDuration: number;
}

export interface ExtensionSettings extends GlobalSettings {
  actions: Record<MediaAction, ActionConfig>;
}

const NON_OVERLAY_ACTIONS = new Set<MediaAction>(["toggleFullscreen", "togglePip"]);

// #endregion

// #region Defaults

export const DEFAULT_SETTINGS: ExtensionSettings = defaults as ExtensionSettings;

export function actionSupportsOverlay(action: MediaAction): boolean {
  return !NON_OVERLAY_ACTIONS.has(action);
}

function isOverlayVisibility(value: unknown): value is OverlayVisibility {
  return value === "All" || value === "None" || value === "Custom";
}

function normalizeOverlayVisibility(
  flatSettings: Partial<GlobalSettings>,
  legacyGlobalSettings:
    | (Partial<GlobalSettings> & {
        overlaysVisible?: boolean;
        overlayVisible?: boolean;
      })
    | undefined,
): OverlayVisibility {
  if (isOverlayVisibility(flatSettings.overlayVisibility)) {
    return flatSettings.overlayVisibility;
  }

  if (isOverlayVisibility(legacyGlobalSettings?.overlayVisibility)) {
    return legacyGlobalSettings.overlayVisibility;
  }

  const legacyVisible =
    legacyGlobalSettings?.overlaysVisible ?? legacyGlobalSettings?.overlayVisible;

  if (typeof legacyVisible === "boolean") {
    return legacyVisible ? "All" : "None";
  }

  return DEFAULT_SETTINGS.overlayVisibility;
}

function normalizeSettings(settings: Partial<ExtensionSettings>): ExtensionSettings {
  const legacyGlobalSettings = (
    settings as {
      globalSettings?: Partial<GlobalSettings> & {
        overlaysVisible?: boolean;
        overlayVisible?: boolean;
      };
    }
  ).globalSettings;

  const normalizedSettings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    ...legacyGlobalSettings,
    overlayVisibility: normalizeOverlayVisibility(settings, legacyGlobalSettings),
    actions: DEFAULT_SETTINGS.actions,
  };

  const normalizedActions = {} as Record<MediaAction, ActionConfig>;

  for (const action of Object.keys(DEFAULT_SETTINGS.actions) as MediaAction[]) {
    const normalizedAction: ActionConfig = {
      ...DEFAULT_SETTINGS.actions[action],
      ...settings.actions?.[action],
    };

    if (!actionSupportsOverlay(action)) {
      delete normalizedAction.overlayVisible;
      delete normalizedAction.overlayPosition;
    }

    normalizedActions[action] = normalizedAction;
  }

  return {
    ...normalizedSettings,
    actions: normalizedActions,
  };
}

export function resolveActionOverlaySettings(
  action: MediaAction,
  actionConfig: ActionConfig,
  globalSettings: GlobalSettings,
): { overlayVisible: boolean; overlayPosition: OverlayPosition } {
  if (!actionSupportsOverlay(action)) {
    return {
      overlayVisible: false,
      overlayPosition: globalSettings.overlayPosition,
    };
  }

  if (globalSettings.overlayVisibility === "None") {
    return {
      overlayVisible: false,
      overlayPosition: actionConfig.overlayPosition ?? globalSettings.overlayPosition,
    };
  }

  if (globalSettings.overlayVisibility === "All") {
    return {
      overlayVisible: true,
      overlayPosition: actionConfig.overlayPosition ?? globalSettings.overlayPosition,
    };
  }

  return {
    overlayVisible: actionConfig.overlayVisible ?? true,
    overlayPosition: actionConfig.overlayPosition ?? globalSettings.overlayPosition,
  };
}

// #endregion

// #region Storage

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.sync.get();
  return normalizeSettings(result as Partial<ExtensionSettings>);
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  await browser.storage.sync.set(settings);
}

// #endregion

// #region Utilities

export function buildKeyToActionMap(
  actions: Record<MediaAction, ActionConfig>,
): Map<string, MediaAction> {
  const map = new Map<string, MediaAction>();
  for (const [action, config] of Object.entries(actions)) {
    for (const key of config.keys) {
      map.set(key, action as MediaAction);
    }
  }
  return map;
}

// #endregion
