import browser from "webextension-polyfill";
import { getDomain } from "tldts";
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

export type SitePolicyMode = "disabled" | "enabled";
export type SitePolicyEmbedsPolicy = "inherit" | "ignore";

export interface SitePolicy {
  pattern: string;
  policy: SitePolicyMode;
  embedsPolicy: SitePolicyEmbedsPolicy;
}

export interface SiteSettings {
  sitePolicies: SitePolicy[];
  /** @deprecated use sitePolicies */
  disabledUrlPatterns: string[];
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
  siteSettings: SiteSettings;
}

export interface SettingsUpdate extends Partial<AdvancedSettings> {
  quickSettings?: {
    hotkeysEnabled?: boolean;
    actionKeyBindings?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  };
  advancedSettings?: Partial<AdvancedSettings>;
  siteSettings?: Partial<SiteSettings>;
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
export const DEFAULT_SITE_SETTINGS: SiteSettings = DEFAULT_SETTINGS.siteSettings;
const ADVANCED_SETTING_KEYS = Object.keys(DEFAULT_ADVANCED_SETTINGS) as (keyof AdvancedSettings)[];

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

function pickAdvancedSettings(settings: Partial<AdvancedSettings>): Partial<AdvancedSettings> {
  return Object.fromEntries(
    ADVANCED_SETTING_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(settings, key)).map(
      (key) => [key, settings[key]],
    ),
  ) as Partial<AdvancedSettings>;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")
  );
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }

  return pathname.replace(/\/+$/, "");
}

function getRegistrableDomain(hostname: string): string | null {
  const normalizedHostname = hostname.toLowerCase();
  return (
    getDomain(normalizedHostname) ??
    (isLocalHostname(normalizedHostname) ? normalizedHostname : null)
  );
}

function parseUrlishValue(value: string): URL | null {
  const trimmedValue = value.trim();
  if (!trimmedValue || /\s/.test(trimmedValue)) {
    return null;
  }

  try {
    return new URL(trimmedValue);
  } catch {
    try {
      return new URL(`https://${trimmedValue}`);
    } catch {
      return null;
    }
  }
}

export function normalizeDisabledUrlPattern(value: string): string | null {
  const parsedUrl = parseUrlishValue(value);
  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    return null;
  }

  const domain = getRegistrableDomain(parsedUrl.hostname);
  if (!domain) {
    return null;
  }

  return `${domain}${normalizePath(parsedUrl.pathname)}`;
}

export function normalizeDisabledUrlPatterns(patterns: string[]): string[] {
  return Array.from(
    new Set(
      patterns
        .map((pattern) => normalizeDisabledUrlPattern(pattern))
        .filter((pattern): pattern is string => pattern !== null),
    ),
  );
}

function parseNormalizedSitePattern(pattern: string): { domain: string; path: string } | null {
  const normalizedPattern = normalizeDisabledUrlPattern(pattern);
  if (!normalizedPattern) {
    return null;
  }

  const slashIndex = normalizedPattern.indexOf("/");
  if (slashIndex === -1) {
    return {
      domain: normalizedPattern,
      path: "",
    };
  }

  return {
    domain: normalizedPattern.slice(0, slashIndex),
    path: normalizedPattern.slice(slashIndex),
  };
}

function getSitePatternSpecificity(pattern: string): number {
  const parsedPattern = parseNormalizedSitePattern(pattern);
  if (!parsedPattern) {
    return -1;
  }

  return parsedPattern.path.length;
}

type StoredSitePolicy = Partial<SitePolicy> & {
  /** @deprecated use embedsPolicy */
  appliesToEmbeds?: boolean;
};

function normalizeSitePolicy(policy: StoredSitePolicy): SitePolicy | null {
  const pattern = normalizeDisabledUrlPattern(policy.pattern ?? "");
  if (!pattern || !["disabled", "enabled"].includes(policy.policy ?? "")) {
    return null;
  }

  const embedsPolicy =
    policy.embedsPolicy === "ignore" || policy.embedsPolicy === "inherit"
      ? policy.embedsPolicy
      : "inherit";

  return {
    pattern,
    policy: policy.policy as SitePolicyMode,
    embedsPolicy,
  };
}

export function normalizeSitePolicies(policies: StoredSitePolicy[]): SitePolicy[] {
  const seen = new Set<string>();
  const normalizedPolicies: SitePolicy[] = [];

  for (const policy of policies) {
    const normalizedPolicy = normalizeSitePolicy(policy);
    if (!normalizedPolicy) {
      continue;
    }

    if (seen.has(normalizedPolicy.pattern)) {
      continue;
    }

    seen.add(normalizedPolicy.pattern);
    normalizedPolicies.push(normalizedPolicy);
  }

  return [...normalizedPolicies].sort((left, right) => left.pattern.localeCompare(right.pattern));
}

function sitePoliciesFromDisabledUrlPatterns(patterns: string[]): SitePolicy[] {
  return normalizeDisabledUrlPatterns(patterns).map((pattern) => ({
    pattern,
    policy: "disabled",
    embedsPolicy: "inherit",
  }));
}

function getDisabledUrlPatternsFromSitePolicies(policies: SitePolicy[]): string[] {
  return policies.filter((policy) => policy.policy === "disabled").map((policy) => policy.pattern);
}

export function getDisabledSitePrefillForUrl(url: string): string | null {
  const parsedUrl = parseUrlishValue(url);
  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    return null;
  }

  return getRegistrableDomain(parsedUrl.hostname);
}

export function getSitePolicySectionPatternForUrl(url: string): string | null {
  const parsedUrl = parseUrlishValue(url);
  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    return null;
  }

  const domain = getRegistrableDomain(parsedUrl.hostname);
  if (!domain) {
    return null;
  }

  const pathSegments = normalizePath(parsedUrl.pathname).split("/").filter(Boolean);
  if (pathSegments.length === 0) {
    return domain;
  }

  return `${domain}/${pathSegments[0]}`;
}

export function findMatchingDisabledUrlPattern(
  url: string,
  disabledUrlPatterns: string[],
): string | undefined {
  const parsedUrl = parseUrlishValue(url);
  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    return undefined;
  }

  const targetDomain = getRegistrableDomain(parsedUrl.hostname);
  if (!targetDomain) {
    return undefined;
  }

  const targetPath = normalizePath(parsedUrl.pathname);
  const normalizedPatterns = normalizeDisabledUrlPatterns(disabledUrlPatterns);

  return normalizedPatterns.find((pattern) => {
    const parsedPattern = parseNormalizedSitePattern(pattern);
    if (!parsedPattern || parsedPattern.domain !== targetDomain) {
      return false;
    }

    if (!parsedPattern.path) {
      return true;
    }

    return targetPath === parsedPattern.path || targetPath.startsWith(`${parsedPattern.path}/`);
  });
}

export function findMatchingSitePolicy(
  url: string,
  siteSettings: SiteSettings,
): SitePolicy | undefined {
  const parsedUrl = parseUrlishValue(url);
  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    return undefined;
  }

  const targetDomain = getRegistrableDomain(parsedUrl.hostname);
  if (!targetDomain) {
    return undefined;
  }

  const targetPath = normalizePath(parsedUrl.pathname);
  const matches: { policy: SitePolicy; index: number }[] = [];

  normalizeSitePolicies(siteSettings.sitePolicies).forEach((policy, index) => {
    const parsedPattern = parseNormalizedSitePattern(policy.pattern);
    if (!parsedPattern || parsedPattern.domain !== targetDomain) {
      return;
    }

    if (
      parsedPattern.path &&
      targetPath !== parsedPattern.path &&
      !targetPath.startsWith(`${parsedPattern.path}/`)
    ) {
      return;
    }

    matches.push({ policy, index });
  });

  matches.sort((left, right) => {
    const specificityDifference =
      getSitePatternSpecificity(right.policy.pattern) -
      getSitePatternSpecificity(left.policy.pattern);
    if (specificityDifference !== 0) {
      return specificityDifference;
    }

    return left.index - right.index;
  });

  return matches[0]?.policy;
}

export function isUrlDisabledBySiteSettings(url: string, siteSettings: SiteSettings): boolean {
  return findMatchingSitePolicy(url, siteSettings)?.policy === "disabled";
}

function normalizeSettings(
  settings: Partial<ExtensionSettings> & SettingsUpdate,
): ExtensionSettings {
  const nestedQuickSettings: Partial<QuickSettings> & {
    actionKeyBindings?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  } = settings.quickSettings ?? {};
  const nestedAdvancedSettings: Partial<AdvancedSettings> = settings.advancedSettings ?? {};
  const nestedSiteSettings: Partial<SiteSettings> = settings.siteSettings ?? {};
  const legacyGlobalSettings = settings.globalSettings ?? {};
  const legacyAdvancedSettings = pickAdvancedSettings(settings);

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
    ...legacyAdvancedSettings,
    ...legacyGlobalSettings,
    ...nestedAdvancedSettings,
  };

  const sitePolicies = normalizeSitePolicies(
    nestedSiteSettings.sitePolicies ??
      sitePoliciesFromDisabledUrlPatterns(
        nestedSiteSettings.disabledUrlPatterns ?? DEFAULT_SITE_SETTINGS.disabledUrlPatterns,
      ),
  );
  const siteSettings: SiteSettings = {
    ...DEFAULT_SITE_SETTINGS,
    ...nestedSiteSettings,
    sitePolicies,
    disabledUrlPatterns: getDisabledUrlPatternsFromSitePolicies(sitePolicies),
  };

  return {
    quickSettings,
    advancedSettings,
    siteSettings,
  };
}

function mergeSettings(
  baseSettings: ExtensionSettings,
  settingsUpdate: SettingsUpdate,
): ExtensionSettings {
  const legacyAdvancedSettings = pickAdvancedSettings(settingsUpdate);
  const updatedSiteSettings =
    settingsUpdate.siteSettings?.disabledUrlPatterns && !settingsUpdate.siteSettings.sitePolicies
      ? {
          ...settingsUpdate.siteSettings,
          sitePolicies: sitePoliciesFromDisabledUrlPatterns(
            settingsUpdate.siteSettings.disabledUrlPatterns,
          ),
        }
      : settingsUpdate.siteSettings;

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
      ...legacyAdvancedSettings,
      ...settingsUpdate.globalSettings,
      ...settingsUpdate.advancedSettings,
    },
    siteSettings: {
      ...baseSettings.siteSettings,
      ...updatedSiteSettings,
    },
  });
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => areValuesEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

export function settingsEqual(left: ExtensionSettings, right: ExtensionSettings): boolean {
  return areValuesEqual(left, right);
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
  const result = await browser.storage.sync.get(null);
  return normalizeSettings(result as Partial<ExtensionSettings> & SettingsUpdate);
}

export async function saveSettings(settingsUpdate: SettingsUpdate): Promise<void> {
  const currentSettings = await getSettings();
  const mergedSettings = mergeSettings(currentSettings, settingsUpdate);
  if (settingsEqual(currentSettings, mergedSettings)) {
    return;
  }

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
