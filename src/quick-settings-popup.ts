import browser from "webextension-polyfill";
import { DELETE } from "./icons.js";
import {
  type ConfigurableMediaAction,
  type ExtensionSettings,
  type SitePolicy,
  DEFAULT_QUICK_SETTINGS,
  findMatchingSitePolicy,
  getDisabledSitePrefillForUrl,
  getSitePolicySectionPatternForUrl,
  getSettings,
  hasReservedModifier,
  normalizeHotkeyKey,
  normalizeSitePolicies,
  saveSettings,
  settingsEqual,
} from "./storage.js";
import { showStatusToast, type StatusToastTone } from "./status-toast.js";

const ACTION_LABELS: Record<ConfigurableMediaAction, string> = {
  togglePlayPause: "Play/Pause",
  toggleMute: "Mute/Unmute",
  toggleFullscreen: "Fullscreen",
  togglePip: "Picture-in-Picture",
  toggleTheater: "Theater Mode",
  speedUp: "Speed Up",
  slowDown: "Slow Down",
  volumeUp: "Volume Up",
  volumeDown: "Volume Down",
  seekForwardSmall: "Skip Forward (Small)",
  seekBackwardSmall: "Skip Backward (Small)",
  seekForwardMedium: "Skip Forward (Medium)",
  seekBackwardMedium: "Skip Backward (Medium)",
  seekForwardLarge: "Skip Forward (Large)",
  seekBackwardLarge: "Skip Backward (Large)",
  restart: "Restart",
  toggleOverlays: "Toggle Overlays",
};

const ACTION_ORDER: ConfigurableMediaAction[] = Object.keys(
  ACTION_LABELS,
) as ConfigurableMediaAction[];

const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: "\u25B2",
  ArrowDown: "\u25BC",
  ArrowLeft: "\u25C0",
  ArrowRight: "\u25B6",
  " ": "Space",
};

const KEY_ACCESSIBLE_LABELS: Record<string, string> = {
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
};

/** Modifier keys pressed on their own: capture waits for the key they're held with. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta"]);

/** Keys that never reach the content script as a usable hotkey, or break keyboard navigation. */
const UNUSABLE_KEY_REASONS = new Map<string, string>([
  ["Tab", "Tab can't be a hotkey because it moves keyboard focus."],
  ["Enter", "Enter can't be a hotkey because it activates buttons and links."],
  ["Dead", "Accent keys that combine with the next key can't be hotkeys."],
  ["Process", "Keys typed through an input method can't be hotkeys."],
  ["Unidentified", "The browser can't identify that key, so it can't be a hotkey."],
  ["CapsLock", "Caps Lock can't be a hotkey."],
  ["NumLock", "Num Lock can't be a hotkey."],
  ["ScrollLock", "Scroll Lock can't be a hotkey."],
  ["Fn", "Fn can't be a hotkey."],
  ["FnLock", "Fn Lock can't be a hotkey."],
  ["Hyper", "Hyper can't be a hotkey."],
  ["Super", "Super can't be a hotkey."],
  ["Symbol", "Symbol can't be a hotkey."],
  ["SymbolLock", "Symbol Lock can't be a hotkey."],
  ["Compose", "Compose can't be a hotkey."],
  ["ContextMenu", "The context menu key can't be a hotkey."],
]);

/**
 * Why a captured key can't be bound, or undefined if it can. Any single character is accepted, so letters
 * typed on non-Latin layouts still bind.
 */
function getUnusableKeyReason(e: KeyboardEvent): string | undefined {
  if (hasReservedModifier(e)) {
    return "Hotkeys don't work while Ctrl, Alt, or Meta is held. Press the key on its own.";
  }

  if (e.isComposing) {
    return UNUSABLE_KEY_REASONS.get("Process");
  }

  return UNUSABLE_KEY_REASONS.get(e.key);
}

let currentSettings: ExtensionSettings;
let activeKeyCaptureCleanup: (() => void) | undefined;
let pendingSave: Promise<void> = Promise.resolve();
let activeBindingAnnouncement: HTMLDivElement | undefined;
let bindingAnnouncementFrameId: number | undefined;
let siteControlPatterns: SiteControlPatterns | undefined;

const DISABLED_SITE_HIGHLIGHT_URL_PARAM = "highlightDisabledSiteUrl";

function displayKey(key: string): string {
  return KEY_DISPLAY[key] ?? key;
}

function accessibleKeyLabel(key: string): string {
  return KEY_ACCESSIBLE_LABELS[key] ?? displayKey(key);
}

function renderKeyChipLabel(key: string): string {
  const visibleLabel = displayKey(key);
  const srLabel = accessibleKeyLabel(key);

  if (visibleLabel === srLabel) {
    return visibleLabel;
  }

  return `<span aria-hidden="true">${visibleLabel}</span><span class="screen-reader">${srLabel}</span>`;
}

function getAnnouncementsContainer(): HTMLDivElement | null {
  const announcements = document.getElementById("announcements");
  if (!announcements) {
    return null;
  }

  return announcements as HTMLDivElement;
}

function getAnnouncementLiveRegion(): HTMLDivElement | null {
  const liveRegion = document.getElementById("announcement-live-region");
  if (!liveRegion) {
    return null;
  }

  return liveRegion as HTMLDivElement;
}

function showAnnouncement(message: string, tone: StatusToastTone): void {
  const announcements = getAnnouncementsContainer();
  const liveRegion = getAnnouncementLiveRegion();
  showStatusToast(message, tone, { container: announcements, liveRegion });
}

function announce(message: string): void {
  showAnnouncement(message, "success");
}

function announceBindingUpdate(message: string): void {
  const liveRegion = getAnnouncementLiveRegion();
  if (!liveRegion) {
    return;
  }

  if (bindingAnnouncementFrameId !== undefined) {
    window.cancelAnimationFrame(bindingAnnouncementFrameId);
  }

  activeBindingAnnouncement?.remove();
  activeBindingAnnouncement = undefined;

  bindingAnnouncementFrameId = window.requestAnimationFrame(() => {
    const announcement = document.createElement("div");
    const content = document.createElement("div");
    content.className = "screen-reader";
    content.textContent = message;
    announcement.appendChild(content);
    liveRegion.replaceChildren(announcement);
    activeBindingAnnouncement = announcement;
    bindingAnnouncementFrameId = undefined;
  });
}

function findActionForKey(
  key: string,
  excludeAction?: ConfigurableMediaAction,
): ConfigurableMediaAction | undefined {
  const normalizedKey = normalizeHotkeyKey(key);
  for (const [action, config] of Object.entries(currentSettings.quickSettings.actionKeyBindings)) {
    if (action === excludeAction) continue;
    if (config.keys.some((existingKey) => normalizeHotkeyKey(existingKey) === normalizedKey)) {
      return action as ConfigurableMediaAction;
    }
  }
  return undefined;
}

function setAddButtonIdleState(button: HTMLButtonElement, action: ConfigurableMediaAction): void {
  button.classList.remove("listening");
  button.innerHTML = `<span aria-hidden="true">+</span>`;
  button.setAttribute("aria-label", `Add shortcut key for ${ACTION_LABELS[action]} action`);
}

function clearActiveKeyCapture(): void {
  activeKeyCaptureCleanup?.();
  activeKeyCaptureCleanup = undefined;
}

function persistSettings(
  nextSettings: ExtensionSettings,
  options?: {
    successMessage?: string;
    failureMessage?: string;
  },
): Promise<void> {
  if (settingsEqual(currentSettings, nextSettings)) {
    return pendingSave;
  }

  currentSettings = nextSettings;
  const settingsToSave = structuredClone(nextSettings);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      try {
        await saveSettings(settingsToSave);
        if (options?.successMessage) {
          showAnnouncement(options.successMessage, "success");
        }
      } catch {
        showAnnouncement(options?.failureMessage ?? "Failed to save settings. Try again.", "error");
      }
    });

  return pendingSave;
}

function renderActionKeyBindingsTable(): void {
  const tbody = document.getElementById("actions-body") as HTMLTableSectionElement;
  tbody.innerHTML = "";

  for (const action of ACTION_ORDER) {
    const config = currentSettings.quickSettings.actionKeyBindings[action];
    const tr = document.createElement("tr");
    const actionLabel = ACTION_LABELS[action];
    const actionId = `action-${action}`;

    const tdLabel = document.createElement("th");
    tdLabel.id = actionId;
    tdLabel.textContent = actionLabel;
    tdLabel.scope = "row";
    tr.appendChild(tdLabel);

    const tdKeys = document.createElement("td");
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "key-chips";

    for (const key of config.keys) {
      const chip = document.createElement("span");
      chip.className = "key-chip";
      chip.innerHTML = `<span class="key-chip-label">${renderKeyChipLabel(key)}</span>`;

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.innerHTML = `<span class="delete-icon" aria-hidden="true">${DELETE}</span>`;
      deleteButton.setAttribute(
        "aria-label",
        `Remove ${accessibleKeyLabel(key)} key from ${actionLabel} action`,
      );
      deleteButton.addEventListener("click", () => {
        removeKeyFromAction(action, key);
      });

      chip.appendChild(deleteButton);
      chipsContainer.appendChild(chip);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "add-key-button";
    addBtn.type = "button";
    setAddButtonIdleState(addBtn, action);
    addBtn.addEventListener("click", () => {
      startKeyCapture(action, addBtn);
    });
    chipsContainer.appendChild(addBtn);

    tdKeys.appendChild(chipsContainer);
    tr.appendChild(tdKeys);
    tbody.appendChild(tr);
  }
}

async function getActiveTabUrl(): Promise<string | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? null;
}

function getAdvancedSettingsUrl(params?: Record<string, string>): string {
  const advancedSettingsUrl = new URL(browser.runtime.getURL("advanced-settings-page.html"));

  for (const [key, value] of Object.entries(params ?? {})) {
    advancedSettingsUrl.searchParams.set(key, value);
  }

  return advancedSettingsUrl.href;
}

async function openAdvancedSettingsPage(params?: Record<string, string>): Promise<void> {
  await browser.tabs.create({
    url: getAdvancedSettingsUrl(params),
  });
  window.close();
}

interface SiteControlPatterns {
  activeTabUrl: string;
  hostPattern: string;
  sectionPattern: string;
}

function getSiteControlPatterns(activeTabUrl: string | null): SiteControlPatterns | undefined {
  if (!activeTabUrl) {
    return undefined;
  }

  const hostPattern = getDisabledSitePrefillForUrl(activeTabUrl);
  const sectionPattern = getSitePolicySectionPatternForUrl(activeTabUrl);
  if (!hostPattern || !sectionPattern) {
    return undefined;
  }

  return { activeTabUrl, hostPattern, sectionPattern };
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setDisplayed(element: HTMLElement | null, displayed: boolean): void {
  if (element) {
    element.style.display = displayed ? "" : "none";
  }
}

function findSitePolicy(pattern: string): SitePolicy | undefined {
  return currentSettings.siteSettings.sitePolicies.find((policy) => policy.pattern === pattern);
}

function withoutSitePolicyPattern(policies: SitePolicy[], pattern: string): SitePolicy[] {
  return policies.filter((policy) => policy.pattern !== pattern);
}

function addOrReplaceSitePolicy(policy: SitePolicy): SitePolicy[] {
  return [
    ...withoutSitePolicyPattern(currentSettings.siteSettings.sitePolicies, policy.pattern),
    policy,
  ];
}

async function persistSitePolicies(sitePolicies: SitePolicy[]): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.siteSettings.sitePolicies = normalizeSitePolicies(sitePolicies);
  nextSettings.siteSettings.disabledUrlPatterns = nextSettings.siteSettings.sitePolicies
    .filter((policy) => policy.policy === "disabled")
    .map((policy) => policy.pattern);
  const saved = persistSettings(nextSettings);
  renderSiteControls();
  await saved;
}

function isSiteDisabledByCheckbox(patterns: SiteControlPatterns): boolean {
  return findSitePolicy(patterns.hostPattern)?.policy === "disabled";
}

function hasSectionCheckbox(patterns: SiteControlPatterns): boolean {
  return patterns.sectionPattern !== patterns.hostPattern;
}

/** The section checkbox disables the section, or re-enables it once the whole domain is disabled. */
function getSectionCheckboxPolicy(patterns: SiteControlPatterns): SitePolicy["policy"] {
  return isSiteDisabledByCheckbox(patterns) ? "enabled" : "disabled";
}

function isSectionCheckboxChecked(patterns: SiteControlPatterns): boolean {
  return (
    hasSectionCheckbox(patterns) &&
    findSitePolicy(patterns.sectionPattern)?.policy === getSectionCheckboxPolicy(patterns)
  );
}

/**
 * The checkboxes show only the domain rule and the first-path-segment rule. When a different rule decides
 * the current page (for example a deeper path), say which one so the checkboxes don't mislead.
 */
function getOtherMatchingPolicy(patterns: SiteControlPatterns): SitePolicy | undefined {
  const matchingPolicy = findMatchingSitePolicy(
    patterns.activeTabUrl,
    currentSettings.siteSettings,
  );
  if (!matchingPolicy) {
    return undefined;
  }

  if (matchingPolicy.pattern === patterns.hostPattern && matchingPolicy.policy === "disabled") {
    return undefined;
  }

  if (matchingPolicy.pattern === patterns.sectionPattern && isSectionCheckboxChecked(patterns)) {
    return undefined;
  }

  return matchingPolicy;
}

/**
 * The key bindings are hidden whenever a "Disable on ..." checkbox is checked for this page, unless a
 * checked "Enable on <section>" override re-enables it.
 */
function isDisabledByCheckbox(patterns: SiteControlPatterns | undefined): boolean {
  if (!currentSettings.quickSettings.hotkeysEnabled) {
    return true;
  }

  if (!patterns) {
    return false;
  }

  // The section checkbox is a Disable when the domain is enabled and an Enable (override) when not.
  return isSiteDisabledByCheckbox(patterns) !== isSectionCheckboxChecked(patterns);
}

function renderSiteControls(): void {
  const enabled = currentSettings.quickSettings.hotkeysEnabled;
  const disableEverywhere = getElement<HTMLInputElement>("disable-everywhere");
  if (disableEverywhere) {
    disableEverywhere.checked = !enabled;
  }
  const bindingsHidden = isDisabledByCheckbox(siteControlPatterns);
  if (bindingsHidden) {
    // The bindings are about to be hidden, so a pending key capture must not keep listening.
    clearActiveKeyCapture();
  }
  setDisplayed(getElement("key-bindings-section"), !bindingsHidden);

  // Site rules don't matter while the extension is disabled everywhere.
  const patterns = enabled ? siteControlPatterns : undefined;
  setDisplayed(getElement("disable-on-site-field"), patterns !== undefined);
  if (!patterns) {
    setDisplayed(getElement("site-section-field"), false);
    setDisplayed(getElement("site-rule-row"), false);
    return;
  }

  const disableOnSite = getElement<HTMLInputElement>("disable-on-site");
  const disableOnSiteLabel = getElement<HTMLLabelElement>("disable-on-site-label");
  if (disableOnSite) {
    disableOnSite.checked = isSiteDisabledByCheckbox(patterns);
  }
  if (disableOnSiteLabel) {
    disableOnSiteLabel.textContent = `Disable on ${patterns.hostPattern}`;
  }

  const siteSection = getElement<HTMLInputElement>("site-section");
  const siteSectionLabel = getElement<HTMLLabelElement>("site-section-label");
  setDisplayed(getElement("site-section-field"), hasSectionCheckbox(patterns));
  if (siteSection) {
    siteSection.checked = isSectionCheckboxChecked(patterns);
  }
  if (siteSectionLabel) {
    const verb = getSectionCheckboxPolicy(patterns) === "enabled" ? "Enable" : "Disable";
    siteSectionLabel.textContent = `${verb} on ${patterns.sectionPattern}`;
  }

  const otherPolicy = getOtherMatchingPolicy(patterns);
  setDisplayed(getElement("site-rule-row"), otherPolicy !== undefined);
  const status = getElement<HTMLParagraphElement>("site-control-status");
  if (status) {
    status.textContent = otherPolicy
      ? `${otherPolicy.policy === "disabled" ? "Disabled" : "Enabled"} here by rule: ${otherPolicy.pattern}`
      : "";
  }
}

function handleDisableOnSiteChange(checked: boolean): void {
  const patterns = siteControlPatterns;
  if (!patterns) {
    return;
  }

  void persistSitePolicies(
    checked
      ? addOrReplaceSitePolicy({
          pattern: patterns.hostPattern,
          policy: "disabled",
          embedsPolicy: "inherit",
        })
      : withoutSitePolicyPattern(currentSettings.siteSettings.sitePolicies, patterns.hostPattern),
  );
}

function handleSiteSectionChange(checked: boolean): void {
  const patterns = siteControlPatterns;
  if (!patterns) {
    return;
  }

  void persistSitePolicies(
    checked
      ? addOrReplaceSitePolicy({
          pattern: patterns.sectionPattern,
          policy: getSectionCheckboxPolicy(patterns),
          embedsPolicy: "inherit",
        })
      : withoutSitePolicyPattern(
          currentSettings.siteSettings.sitePolicies,
          patterns.sectionPattern,
        ),
  );
}

function handleDisableEverywhereChange(checked: boolean): void {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.quickSettings.hotkeysEnabled = !checked;
  void persistSettings(nextSettings);
  renderSiteControls();
}

function renderVersion(): void {
  const version = getElement<HTMLSpanElement>("extension-version");
  if (version) {
    version.textContent = `v${browser.runtime.getManifest().version}`;
  }
}

function removeKeyFromAction(action: ConfigurableMediaAction, key: string): void {
  const nextSettings = structuredClone(currentSettings);
  const config = nextSettings.quickSettings.actionKeyBindings[action];
  const normalizedKey = normalizeHotkeyKey(key);
  config.keys = config.keys.filter(
    (existingKey) => normalizeHotkeyKey(existingKey) !== normalizedKey,
  );
  void persistSettings(nextSettings);
  renderActionKeyBindingsTable();
  announceBindingUpdate(`${accessibleKeyLabel(key)} removed from ${ACTION_LABELS[action]}.`);
}

function startKeyCapture(action: ConfigurableMediaAction, button: HTMLButtonElement): void {
  clearActiveKeyCapture();
  button.classList.add("listening");
  button.textContent = "Press a key";
  button.setAttribute("aria-label", `Press a key to assign it to ${ACTION_LABELS[action]}`);
  announce(`Listening for a shortcut key for ${ACTION_LABELS[action]}. Press Escape to cancel.`);

  const handler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      clearActiveKeyCapture();
      announce(`Key assignment canceled for ${ACTION_LABELS[action]}.`);
      return;
    }

    if (MODIFIER_KEYS.has(e.key)) {
      return;
    }

    const unusableKeyReason = getUnusableKeyReason(e);
    if (unusableKeyReason) {
      // Keep listening so the user can press a different key.
      showAnnouncement(`${unusableKeyReason} Press another key, or Escape to cancel.`, "error");
      return;
    }

    const key = normalizeHotkeyKey(e.key);
    const conflict = findActionForKey(key, action);
    const nextSettings = structuredClone(currentSettings);

    if (conflict) {
      const conflictConfig = nextSettings.quickSettings.actionKeyBindings[conflict];
      conflictConfig.keys = conflictConfig.keys.filter(
        (existingKey) => normalizeHotkeyKey(existingKey) !== key,
      );
    }

    if (
      !nextSettings.quickSettings.actionKeyBindings[action].keys.some(
        (existingKey) => normalizeHotkeyKey(existingKey) === key,
      )
    ) {
      nextSettings.quickSettings.actionKeyBindings[action].keys.push(key);
    }

    clearActiveKeyCapture();
    void persistSettings(nextSettings);
    renderActionKeyBindingsTable();

    const keyLabel = accessibleKeyLabel(key);
    const conflictMessage = conflict
      ? ` ${keyLabel} was removed from ${ACTION_LABELS[conflict]}.`
      : "";
    announceBindingUpdate(`${keyLabel} assigned to ${ACTION_LABELS[action]}.${conflictMessage}`);
  };

  document.addEventListener("keydown", handler, true);
  activeKeyCaptureCleanup = () => {
    document.removeEventListener("keydown", handler, true);
    setAddButtonIdleState(button, action);
  };
}

async function handleReset(): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.quickSettings = structuredClone(DEFAULT_QUICK_SETTINGS);
  await persistSettings(nextSettings, {
    successMessage: "Quick settings reset to default values.",
    failureMessage: "Failed to reset quick settings. Try again.",
  });

  renderSiteControls();
  renderActionKeyBindingsTable();
}

async function handleAdvancedSettings(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function init(): Promise<void> {
  renderVersion();
  currentSettings = await getSettings();
  renderActionKeyBindingsTable();
  renderSiteControls();

  getElement<HTMLInputElement>("disable-everywhere")?.addEventListener("change", (event) => {
    handleDisableEverywhereChange((event.currentTarget as HTMLInputElement).checked);
  });
  getElement<HTMLInputElement>("disable-on-site")?.addEventListener("change", (event) => {
    handleDisableOnSiteChange((event.currentTarget as HTMLInputElement).checked);
  });
  getElement<HTMLInputElement>("site-section")?.addEventListener("change", (event) => {
    handleSiteSectionChange((event.currentTarget as HTMLInputElement).checked);
  });
  getElement("site-edit-rule-button")?.addEventListener("click", () => {
    if (siteControlPatterns) {
      void openAdvancedSettingsPage({
        [DISABLED_SITE_HIGHLIGHT_URL_PARAM]: siteControlPatterns.activeTabUrl,
      });
    }
  });
  getElement("reset")?.addEventListener("click", () => {
    void handleReset();
  });
  getElement("advanced-settings")?.addEventListener("click", () => {
    void handleAdvancedSettings();
  });

  try {
    siteControlPatterns = getSiteControlPatterns(await getActiveTabUrl());
  } catch {
    siteControlPatterns = undefined;
  }
  renderSiteControls();
}

void init().catch(() => {
  showAnnouncement(
    "Failed to load quick settings. Try reinstalling the extension or restarting the browser.",
    "error",
  );
});
