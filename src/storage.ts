import browser from "webextension-polyfill";
import { getDomain } from "tldts";
import defaults from "./settings/defaults.json";

// #region Types

export const MEDIA_ACTIONS = [
  "togglePlayPause",
  "toggleMute",
  "toggleOverlays",
  "toggleFullscreen",
  "togglePip",
  "toggleTheater",
  "speedUp",
  "slowDown",
  "volumeUp",
  "volumeDown",
  "seekForwardSmall",
  "seekBackwardSmall",
  "seekForwardMedium",
  "seekBackwardMedium",
  "seekForwardLarge",
  "seekBackwardLarge",
  "restart",
  "seekToPercent0",
  "seekToPercent10",
  "seekToPercent20",
  "seekToPercent30",
  "seekToPercent40",
  "seekToPercent50",
  "seekToPercent60",
  "seekToPercent70",
  "seekToPercent80",
  "seekToPercent90",
] as const;

export type MediaAction = (typeof MEDIA_ACTIONS)[number];

export function isMediaAction(value: unknown): value is MediaAction {
  return MEDIA_ACTIONS.includes(value as MediaAction);
}

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

export interface SettingsUpdate {
  quickSettings?: {
    hotkeysEnabled?: boolean;
    actionKeyBindings?: Partial<Record<ConfigurableMediaAction, ActionConfig>>;
  };
  advancedSettings?: Partial<AdvancedSettings>;
  siteSettings?: Partial<SiteSettings>;
}

const NON_OVERLAY_ACTIONS = new Set<MediaAction>([
  "toggleFullscreen",
  "togglePip",
  "toggleTheater",
]);

// #endregion

// #region Defaults

export const DEFAULT_SETTINGS: ExtensionSettings = defaults as ExtensionSettings;
export const DEFAULT_QUICK_SETTINGS: QuickSettings = DEFAULT_SETTINGS.quickSettings;
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = DEFAULT_SETTINGS.advancedSettings;
export const DEFAULT_SITE_SETTINGS: SiteSettings = DEFAULT_SETTINGS.siteSettings;

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
): Record<ConfigurableMediaAction, ActionConfig> {
  const normalizedBindings = {} as Record<ConfigurableMediaAction, ActionConfig>;
  const userKeys = new Set(
    Object.values(storedBindings ?? {})
      .flatMap((binding) => binding?.keys ?? [])
      .map(normalizeHotkeyKey),
  );

  for (const action of Object.keys(
    DEFAULT_QUICK_SETTINGS.actionKeyBindings,
  ) as ConfigurableMediaAction[]) {
    const defaultBinding = DEFAULT_QUICK_SETTINGS.actionKeyBindings[action];
    const hasUserKeys = Boolean(storedBindings?.[action]?.keys);
    normalizedBindings[action] = {
      ...defaultBinding,
      // An action added after the user saved bindings must not take over a key
      // they already assigned to something else.
      keys: hasUserKeys
        ? defaultBinding.keys
        : defaultBinding.keys.filter((key) => !userKeys.has(normalizeHotkeyKey(key))),
      ...storedBindings?.[action],
    };
  }

  return normalizedBindings;
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

// Private suffixes (github.io, vercel.app, ...) count as public suffixes, so a rule for
// alice.github.io covers only that site instead of every site on the hosting platform.
function getRegistrableDomain(hostname: string): string | null {
  const normalizedHostname = hostname.toLowerCase();
  return (
    getDomain(normalizedHostname, { allowPrivateDomains: true }) ??
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

function normalizeSitePolicy(policy: Partial<SitePolicy>): SitePolicy | null {
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

export function normalizeSitePolicies(policies: Partial<SitePolicy>[]): SitePolicy[] {
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

  // Only a first segment followed by a slash is a section (/shorts/abc); /watch?v=abc is a page.
  const firstSegment = /^\/+([^/]+)\//.exec(parsedUrl.pathname)?.[1];
  return firstSegment ? `${domain}/${firstSegment}` : domain;
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

function normalizeSettings(settings: SettingsUpdate): ExtensionSettings {
  const nestedQuickSettings = settings.quickSettings ?? {};
  const nestedAdvancedSettings = settings.advancedSettings ?? {};
  const nestedSiteSettings = settings.siteSettings ?? {};

  const quickSettings: QuickSettings = {
    ...DEFAULT_QUICK_SETTINGS,
    ...nestedQuickSettings,
    hotkeysEnabled: nestedQuickSettings.hotkeysEnabled ?? DEFAULT_QUICK_SETTINGS.hotkeysEnabled,
    actionKeyBindings: mergeActionKeyBindings(nestedQuickSettings.actionKeyBindings),
  };

  const advancedSettings: AdvancedSettings = {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...nestedAdvancedSettings,
  };

  const siteSettings: SiteSettings = {
    sitePolicies: normalizeSitePolicies(
      nestedSiteSettings.sitePolicies ?? DEFAULT_SITE_SETTINGS.sitePolicies,
    ),
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
  return normalizeSettings({
    quickSettings: {
      ...baseSettings.quickSettings,
      ...settingsUpdate.quickSettings,
      hotkeysEnabled:
        settingsUpdate.quickSettings?.hotkeysEnabled ?? baseSettings.quickSettings.hotkeysEnabled,
      actionKeyBindings: {
        ...baseSettings.quickSettings.actionKeyBindings,
        ...settingsUpdate.quickSettings?.actionKeyBindings,
      },
    },
    advancedSettings: {
      ...baseSettings.advancedSettings,
      ...settingsUpdate.advancedSettings,
    },
    siteSettings: {
      ...baseSettings.siteSettings,
      ...settingsUpdate.siteSettings,
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
  return normalizeSettings(result as SettingsUpdate);
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

// Layouts such as German and French type characters like `[` and `]` with
// AltGr, which Windows reports as Ctrl+Alt. Those keys are plain characters,
// not shortcuts.
export function hasReservedModifier(e: KeyboardEvent): boolean {
  if (e.metaKey) return true;
  if (e.getModifierState("AltGraph")) return false;
  return e.altKey || e.ctrlKey;
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
