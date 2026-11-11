import browser from "webextension-polyfill";
import defaults from "./settings/defaults.json";

// #region Types

export const MEDIA_ACTIONS = [
  "togglePlayPause",
  "toggleMute",
  "toggleOverlays",
  "toggleFullscreen",
  "togglePip",
  "toggleTheater",
  "toggleCaptions",
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

export const OVERLAY_POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const SKIP_OVERLAY_POSITIONS = ["left / right", "same as others"] as const;

export type SkipOverlayPosition = (typeof SKIP_OVERLAY_POSITIONS)[number];

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

/**
 * A patch for `saveSettings`: only the fields present are written. A field whose value
 * equals its default is removed from storage instead (see "Storage" below).
 */
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

/**
 * Keys that can't work as hotkeys: they move focus, activate buttons, or never reach the page as a
 * character. Quick Settings refuses to bind them (with a reason for each, keyed by this list), and
 * loading settings drops them from saved bindings, so one that was saved before the popup refused it,
 * or edited into storage by hand, takes nothing from the page.
 */
export const UNUSABLE_HOTKEYS = [
  "Tab",
  "Enter",
  "Dead",
  "Process",
  "Unidentified",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "Symbol",
  "SymbolLock",
  "Compose",
  "ContextMenu",
] as const;

export type UnusableHotkey = (typeof UNUSABLE_HOTKEYS)[number];

export function isUnusableHotkey(key: string): key is UnusableHotkey {
  return UNUSABLE_HOTKEYS.includes(key as UnusableHotkey);
}

function mergeActionKeyBindings(
  storedKeys: Partial<Record<ConfigurableMediaAction, string[]>>,
): Record<ConfigurableMediaAction, ActionConfig> {
  const normalizedBindings = {} as Record<ConfigurableMediaAction, ActionConfig>;
  // Only actions the user changed are stored, so these are the keys they chose themselves.
  const userKeys = new Set(Object.values(storedKeys).flat().map(normalizeHotkeyKey));

  for (const action of Object.keys(
    DEFAULT_QUICK_SETTINGS.actionKeyBindings,
  ) as ConfigurableMediaAction[]) {
    const defaultKeys = DEFAULT_QUICK_SETTINGS.actionKeyBindings[action].keys;
    // An action added in a later release must not take over a key the user already
    // assigned to something else.
    normalizedBindings[action] = {
      keys:
        storedKeys[action] ?? defaultKeys.filter((key) => !userKeys.has(normalizeHotkeyKey(key))),
    };
  }

  return normalizedBindings;
}

/** localhost and IP addresses, which have no subdomains and match only themselves. */
export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")
  );
}

export function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }

  return pathname.replace(/\/+$/, "");
}

/** Parses a URL or bare `host/path` entry, and returns it only if it is http(s). */
export function parseHttpUrl(value: string): URL | null {
  const trimmedValue = value.trim();
  if (!trimmedValue || /\s/.test(trimmedValue)) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    try {
      parsedUrl = new URL(`https://${trimmedValue}`);
    } catch {
      return null;
    }
  }

  return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl : null;
}

// Saved patterns are already a host (as typed, minus a leading `www.`) plus an optional
// path, validated by `normalizeDisabledUrlPattern` in `src/site-patterns.ts`, which the
// popup and options page run before saving. This module only checks their shape and
// matches whole labels, so the content script, which imports it, doesn't load the
// public suffix list.
const SITE_PATTERN_DOMAIN = /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])$/;

function splitSitePattern(pattern: string): { domain: string; path: string } | null {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern || /\s/.test(trimmedPattern)) {
    return null;
  }

  // Hostnames are case-insensitive, but URL paths are not, so only the domain is lowercased.
  const slashIndex = trimmedPattern.indexOf("/");
  const domain = (
    slashIndex === -1 ? trimmedPattern : trimmedPattern.slice(0, slashIndex)
  ).toLowerCase();
  if (!SITE_PATTERN_DOMAIN.test(domain)) {
    return null;
  }

  return {
    domain,
    path: slashIndex === -1 ? "" : normalizePath(trimmedPattern.slice(slashIndex)),
  };
}

function normalizeStoredSitePattern(pattern: string): string | null {
  const parsedPattern = splitSitePattern(pattern);
  return parsedPattern ? `${parsedPattern.domain}${parsedPattern.path}` : null;
}

/**
 * Validates, deduplicates (the first rule for a pattern wins), and sorts site policies.
 * `normalizePattern` turns each entry into its saved pattern, or null to drop it.
 */
export function normalizeSitePoliciesWith(
  policies: Partial<SitePolicy>[],
  normalizePattern: (pattern: string) => string | null,
): SitePolicy[] {
  const seen = new Set<string>();
  const normalizedPolicies: SitePolicy[] = [];

  for (const policy of policies) {
    const pattern = normalizePattern(policy.pattern ?? "");
    if (!pattern || !["disabled", "enabled"].includes(policy.policy ?? "")) {
      continue;
    }

    if (seen.has(pattern)) {
      continue;
    }

    seen.add(pattern);
    normalizedPolicies.push({
      pattern,
      policy: policy.policy as SitePolicyMode,
      embedsPolicy: policy.embedsPolicy === "ignore" ? "ignore" : "inherit",
    });
  }

  return normalizedPolicies.sort((left, right) => left.pattern.localeCompare(right.pattern));
}

// A saved domain matches the host that equals it and every host that ends with `.domain`
// (whole labels only): youtube.com covers www.youtube.com and music.youtube.com, but
// never notyoutube.com, and music.youtube.com leaves the rest of youtube.com alone.
function hostnameMatchesSiteDomain(hostname: string, domain: string): boolean {
  if (hostname === domain) {
    return true;
  }

  return !isLocalHostname(hostname) && !isLocalHostname(domain) && hostname.endsWith(`.${domain}`);
}

export function findMatchingSitePolicy(
  url: string,
  siteSettings: SiteSettings,
): SitePolicy | undefined {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return undefined;
  }

  const targetHostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (!targetHostname) {
    return undefined;
  }

  const targetPath = normalizePath(parsedUrl.pathname);
  const matches: { domain: string; path: string; policy: SitePolicy; index: number }[] = [];

  normalizeSitePoliciesWith(siteSettings.sitePolicies, normalizeStoredSitePattern).forEach(
    (policy, index) => {
      const parsedPattern = splitSitePattern(policy.pattern);
      if (!parsedPattern || !hostnameMatchesSiteDomain(targetHostname, parsedPattern.domain)) {
        return;
      }

      if (
        parsedPattern.path &&
        targetPath !== parsedPattern.path &&
        !targetPath.startsWith(`${parsedPattern.path}/`)
      ) {
        return;
      }

      matches.push({ ...parsedPattern, policy, index });
    },
  );

  // The most specific rule wins: the longest domain, then the longest path. Saved domains
  // nest whenever one is a suffix of another (youtube.com and music.youtube.com), and the
  // longer one is then the page's own host.
  matches.sort(
    (left, right) =>
      right.domain.length - left.domain.length ||
      right.path.length - left.path.length ||
      left.index - right.index,
  );

  return matches[0]?.policy;
}

export function isUrlDisabledBySiteSettings(url: string, siteSettings: SiteSettings): boolean {
  return findMatchingSitePolicy(url, siteSettings)?.policy === "disabled";
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

// Settings are stored as flat keys in `storage.sync`, one per setting, and only the settings the
// user changed are stored. A setting with no key has its default from `defaults.json`, so a default
// changed in a later release reaches everyone who never touched it, and "reset" is removing the key.
//
//   schemaVersion              number, written once so a later layout can migrate
//   quick.hotkeysEnabled       boolean
//   advanced.<setting>         one key per `AdvancedSettings` field
//   keys.<action>              that action's list of keys
//   sitePolicies               the site rules, one array for now
//
// A save writes and removes only the keys it was given, and never reads the settings, so saves
// that touch different settings can't overwrite each other. Keys this version doesn't know (an
// older layout, or one written by a newer version) are ignored when reading and never removed.
// `schemaVersion` is written only while it is missing, so an older version doesn't lower the
// marker a newer one stored. The check and the write aren't atomic, so two writers that both see
// it missing can still write version 1 after a newer one wrote its own: a migration that relies
// on the marker has to tolerate that.
//
// Limits, from the Chrome and Firefox documentation: 8,192 bytes per item (key included), 512
// items, and about 100 KB in total, with Chrome also capping writes at 120 per minute and 1,800
// per hour (`set` and `remove` each count as one). Every setting but `sitePolicies` is small in
// practice (35 items and about 2 KB with all of them customized and long key lists; the popup
// adds one key per press, so a key list would need hundreds of distinct keys to reach 8 KB).
// `sitePolicies`, the one array that grows with use, is the one to watch: about 150 simple rules
// fit in its 8 KB item. A save that exceeds a limit is rejected and reported like any failed save.
export const SETTINGS_SCHEMA_VERSION = 1;

const SCHEMA_VERSION_KEY = "schemaVersion";
const HOTKEYS_ENABLED_KEY = "quick.hotkeysEnabled";
const ADVANCED_KEY_PREFIX = "advanced.";
const ACTION_KEYS_PREFIX = "keys.";
const SITE_POLICIES_KEY = "sitePolicies";

const ADVANCED_SETTING_NAMES = Object.keys(DEFAULT_ADVANCED_SETTINGS) as (keyof AdvancedSettings)[];
const CONFIGURABLE_ACTIONS = Object.keys(
  DEFAULT_QUICK_SETTINGS.actionKeyBindings,
) as ConfigurableMediaAction[];

/** The advanced settings that are numbers. */
export type NumericAdvancedSetting = {
  [Name in keyof AdvancedSettings]: AdvancedSettings[Name] extends number ? Name : never;
}[keyof AdvancedSettings];

/**
 * The range each numeric advanced setting may take, inclusive. Settings are clamped to it as they
 * are read and saved, whatever put the value in storage. The number inputs on the Advanced Settings
 * page carry the same limits as `min` and `max` (`volumeStep` is stored as a fraction, the page
 * shows a percentage), and a test fails if the two differ. Each range holds its default, and the
 * speed ranges can't cross, so `speedMin` never exceeds `speedMax`.
 */
export const ADVANCED_NUMBER_LIMITS: Record<NumericAdvancedSetting, { min: number; max: number }> =
  {
    volumeStep: { min: 0.01, max: 0.1 },
    speedMin: { min: 0.1, max: 1 },
    speedMax: { min: 1, max: 8 },
    speedStep: { min: 0.05, max: 1 },
    seekStepSmall: { min: 1, max: 600 },
    seekStepMedium: { min: 1, max: 600 },
    seekStepLarge: { min: 1, max: 600 },
    overlayVisibleDuration: { min: 0, max: 1000 },
    overlayFadeDuration: { min: 0, max: 2000 },
  };

/**
 * The value to use for a stored or saved advanced setting: a number outside its range is clamped
 * to the nearest limit, and a value of the wrong type (or a number that isn't finite) is invalid,
 * which gives undefined. Reading then uses the default for that setting, and a save leaves it out of
 * the write, so what is already stored stays as it was.
 */
function normalizeAdvancedSetting<Name extends keyof AdvancedSettings>(
  name: Name,
  value: unknown,
): AdvancedSettings[Name] | undefined {
  const defaultValue = DEFAULT_ADVANCED_SETTINGS[name];
  if (typeof value !== typeof defaultValue) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    const { min, max } = ADVANCED_NUMBER_LIMITS[name as NumericAdvancedSetting];
    return Math.min(Math.max(value, min), max) as AdvancedSettings[Name];
  }

  if (name === "overlayPosition" && !OVERLAY_POSITIONS.includes(value as OverlayPosition)) {
    return undefined;
  }

  if (
    name === "skipOverlayPosition" &&
    !SKIP_OVERLAY_POSITIONS.includes(value as SkipOverlayPosition)
  ) {
    return undefined;
  }

  return value as AdvancedSettings[Name];
}

function isValidKeyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === "string" && key.length > 0);
}

/**
 * Builds the settings from the stored keys, filling every setting that has no key from the defaults.
 * Keys that can't work as hotkeys (`isUnusableHotkey`) are left out of the key bindings.
 */
function readStoredSettings(stored: Record<string, unknown>): ExtensionSettings {
  const hotkeysEnabled = stored[HOTKEYS_ENABLED_KEY];

  const advancedSettings: AdvancedSettings = { ...DEFAULT_ADVANCED_SETTINGS };
  for (const name of ADVANCED_SETTING_NAMES) {
    const value = normalizeAdvancedSetting(name, stored[ADVANCED_KEY_PREFIX + name]);
    if (value !== undefined) {
      (advancedSettings[name] as AdvancedSettings[typeof name]) = value;
    }
  }

  const storedKeys: Partial<Record<ConfigurableMediaAction, string[]>> = {};
  for (const action of CONFIGURABLE_ACTIONS) {
    const keys = stored[ACTION_KEYS_PREFIX + action];
    if (isValidKeyList(keys)) {
      // Dropped only from what is read: the stored list stays until the user edits that action.
      // An action left with no key is unbound, as it is when the user removes its last key.
      storedKeys[action] = keys.filter((key) => !isUnusableHotkey(key));
    }
  }

  const sitePolicies = stored[SITE_POLICIES_KEY];

  return {
    quickSettings: {
      hotkeysEnabled:
        typeof hotkeysEnabled === "boolean"
          ? hotkeysEnabled
          : DEFAULT_QUICK_SETTINGS.hotkeysEnabled,
      actionKeyBindings: mergeActionKeyBindings(storedKeys),
    },
    advancedSettings,
    siteSettings: {
      sitePolicies: normalizeSitePoliciesWith(
        Array.isArray(sitePolicies) ? sitePolicies : DEFAULT_SITE_SETTINGS.sitePolicies,
        normalizeStoredSitePattern,
      ),
    },
  };
}

/** The storage key and (normalized) value of every setting a patch names. Out-of-range numbers are clamped and other invalid values dropped. */
function flattenUpdate(update: SettingsUpdate): Map<string, { value: unknown; fallback: unknown }> {
  const entries = new Map<string, { value: unknown; fallback: unknown }>();

  const hotkeysEnabled = update.quickSettings?.hotkeysEnabled;
  if (typeof hotkeysEnabled === "boolean") {
    entries.set(HOTKEYS_ENABLED_KEY, {
      value: hotkeysEnabled,
      fallback: DEFAULT_QUICK_SETTINGS.hotkeysEnabled,
    });
  }

  for (const action of CONFIGURABLE_ACTIONS) {
    const keys = update.quickSettings?.actionKeyBindings?.[action]?.keys;
    if (isValidKeyList(keys)) {
      entries.set(ACTION_KEYS_PREFIX + action, {
        value: keys,
        fallback: DEFAULT_QUICK_SETTINGS.actionKeyBindings[action].keys,
      });
    }
  }

  for (const name of ADVANCED_SETTING_NAMES) {
    const value = normalizeAdvancedSetting(name, update.advancedSettings?.[name]);
    if (value !== undefined) {
      entries.set(ADVANCED_KEY_PREFIX + name, { value, fallback: DEFAULT_ADVANCED_SETTINGS[name] });
    }
  }

  const sitePolicies = update.siteSettings?.sitePolicies;
  if (Array.isArray(sitePolicies)) {
    entries.set(SITE_POLICIES_KEY, {
      value: normalizeSitePoliciesWith(sitePolicies, normalizeStoredSitePattern),
      fallback: DEFAULT_SITE_SETTINGS.sitePolicies,
    });
  }

  return entries;
}

/** The patch that turns `base` into `next`, or undefined when they are the same. */
export function diffSettings(
  base: ExtensionSettings,
  next: ExtensionSettings,
): SettingsUpdate | undefined {
  const update: SettingsUpdate = {};

  if (base.quickSettings.hotkeysEnabled !== next.quickSettings.hotkeysEnabled) {
    update.quickSettings = { hotkeysEnabled: next.quickSettings.hotkeysEnabled };
  }

  for (const action of CONFIGURABLE_ACTIONS) {
    const keys = next.quickSettings.actionKeyBindings[action].keys;
    if (!areValuesEqual(base.quickSettings.actionKeyBindings[action].keys, keys)) {
      update.quickSettings ??= {};
      update.quickSettings.actionKeyBindings ??= {};
      update.quickSettings.actionKeyBindings[action] = { keys: [...keys] };
    }
  }

  for (const name of ADVANCED_SETTING_NAMES) {
    if (!Object.is(base.advancedSettings[name], next.advancedSettings[name])) {
      update.advancedSettings ??= {};
      (update.advancedSettings[name] as AdvancedSettings[typeof name]) =
        next.advancedSettings[name];
    }
  }

  if (!areValuesEqual(base.siteSettings.sitePolicies, next.siteSettings.sitePolicies)) {
    update.siteSettings = { sitePolicies: structuredClone(next.siteSettings.sitePolicies) };
  }

  return Object.keys(update).length > 0 ? update : undefined;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get(null);
  return readStoredSettings(stored);
}

/**
 * Saves a patch: sets the keys whose value differs from the default and removes the keys whose
 * value is back at the default. It never reads the settings (only the schema marker), so it can't
 * write back values another surface changed meanwhile; two saves for different settings both land, and for the same setting
 * the last write wins. The only writer of `storage.sync`.
 */
export async function saveSettings(update: SettingsUpdate): Promise<void> {
  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];

  for (const [key, { value, fallback }] of flattenUpdate(update)) {
    if (areValuesEqual(value, fallback)) {
      toRemove.push(key);
    } else {
      toSet[key] = value;
    }
  }

  if (Object.keys(toSet).length > 0) {
    const stored = await browser.storage.sync.get(SCHEMA_VERSION_KEY);
    if (typeof stored[SCHEMA_VERSION_KEY] !== "number") {
      toSet[SCHEMA_VERSION_KEY] = SETTINGS_SCHEMA_VERSION;
    }
    await browser.storage.sync.set(toSet);
  }

  if (toRemove.length > 0) {
    await browser.storage.sync.remove(toRemove);
  }
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
