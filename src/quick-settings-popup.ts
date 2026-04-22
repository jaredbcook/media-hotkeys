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

let currentSettings: ExtensionSettings;
let activeKeyCaptureCleanup: (() => void) | undefined;
let pendingSave: Promise<void> = Promise.resolve();
let activeBindingAnnouncement: HTMLDivElement | undefined;
let bindingAnnouncementFrameId: number | undefined;

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

function setUnavailableSiteControls(): void {
  const container = document.getElementById("site-controls-container");
  if (container) {
    container.style.display = "none";
  }
}

function resetSiteControlButton(): HTMLButtonElement | null {
  const button = document.getElementById("site-control-button") as HTMLButtonElement | null;
  if (!button) {
    return null;
  }

  const nextButton = button.cloneNode() as HTMLButtonElement;
  button.replaceWith(nextButton);
  return nextButton;
}

function resetSiteEditButton(): HTMLButtonElement | null {
  const button = document.getElementById("site-edit-rule-button") as HTMLButtonElement | null;
  if (!button) {
    return null;
  }

  const nextButton = button.cloneNode() as HTMLButtonElement;
  button.replaceWith(nextButton);
  return nextButton;
}

function getSiteControlStatus(): HTMLParagraphElement | null {
  return document.getElementById("site-control-status") as HTMLParagraphElement | null;
}

function setSiteControlStatus(message: string): void {
  const status = getSiteControlStatus();
  if (status) {
    status.textContent = message;
  }
}

function withoutSitePolicyPattern(policies: SitePolicy[], pattern: string): SitePolicy[] {
  return policies.filter((policy) => policy.pattern !== pattern);
}

function hasBroaderDisabledPolicy(activeTabUrl: string, excludedPattern: string): boolean {
  return (
    findMatchingSitePolicy(activeTabUrl, {
      ...currentSettings.siteSettings,
      sitePolicies: currentSettings.siteSettings.sitePolicies.filter(
        (policy) => policy.pattern !== excludedPattern,
      ),
    })?.policy === "disabled"
  );
}

async function persistSitePolicies(
  sitePolicies: SitePolicy[],
  successMessage: string,
): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.siteSettings.sitePolicies = normalizeSitePolicies(sitePolicies);
  nextSettings.siteSettings.disabledUrlPatterns = nextSettings.siteSettings.sitePolicies
    .filter((policy) => policy.policy === "disabled")
    .map((policy) => policy.pattern);
  await persistSettings(nextSettings, { successMessage });
  void renderSiteControls();
}

function addOrReplaceSitePolicy(policy: SitePolicy): SitePolicy[] {
  return [
    ...withoutSitePolicyPattern(currentSettings.siteSettings.sitePolicies, policy.pattern),
    policy,
  ];
}

async function renderSiteControls(): Promise<void> {
  const container = document.getElementById("site-controls-container");
  const button = resetSiteControlButton();
  const editButton = resetSiteEditButton();
  if (!container || !button) {
    return;
  }
  const status = getSiteControlStatus();
  if (status) {
    status.textContent = "";
  }
  if (editButton) {
    editButton.style.display = "none";
  }

  try {
    const activeTabUrl = await getActiveTabUrl();
    if (!activeTabUrl) {
      setUnavailableSiteControls();
      return;
    }

    const hostPattern = getDisabledSitePrefillForUrl(activeTabUrl);
    const sectionPattern = getSitePolicySectionPatternForUrl(activeTabUrl);
    if (!hostPattern || !sectionPattern) {
      setUnavailableSiteControls();
      return;
    }

    const matchingPolicy = findMatchingSitePolicy(activeTabUrl, currentSettings.siteSettings);
    const editMatchingRule = () => {
      void openAdvancedSettingsPage({
        [DISABLED_SITE_HIGHLIGHT_URL_PARAM]: activeTabUrl,
      });
    };

    if (matchingPolicy?.policy === "disabled") {
      container.style.display = "";
      setSiteControlStatus(`Media Hotkeys disabled by rule: ${matchingPolicy.pattern}`);
      if (matchingPolicy.pattern === sectionPattern) {
        button.textContent = "Enable on this site";
        button.addEventListener("click", () => {
          void persistSitePolicies(
            withoutSitePolicyPattern(
              currentSettings.siteSettings.sitePolicies,
              matchingPolicy.pattern,
            ),
            `Enabled on ${matchingPolicy.pattern}`,
          );
        });
      } else {
        button.textContent = "Enable on this section";
        button.addEventListener("click", () => {
          void persistSitePolicies(
            addOrReplaceSitePolicy({
              pattern: sectionPattern,
              policy: "enabled",
              embedsPolicy: "inherit",
            }),
            `Enabled on ${sectionPattern}`,
          );
        });
      }
      if (editButton) {
        editButton.style.display = "";
        editButton.textContent = "Edit site rule";
        editButton.addEventListener("click", editMatchingRule);
      }
      return;
    }

    if (matchingPolicy?.policy === "enabled") {
      container.style.display = "";
      setSiteControlStatus(`Media Hotkeys enabled by rule: ${matchingPolicy.pattern}`);
      button.textContent = "Disable on this section";
      button.addEventListener("click", () => {
        const remainingPolicies = withoutSitePolicyPattern(
          currentSettings.siteSettings.sitePolicies,
          matchingPolicy.pattern,
        );
        const nextPolicies = hasBroaderDisabledPolicy(activeTabUrl, matchingPolicy.pattern)
          ? remainingPolicies
          : [
              ...withoutSitePolicyPattern(remainingPolicies, sectionPattern),
              {
                pattern: sectionPattern,
                policy: "disabled" as const,
                embedsPolicy: "inherit" as const,
              },
            ];
        void persistSitePolicies(nextPolicies, `Disabled on ${sectionPattern}`);
      });
      if (editButton) {
        editButton.style.display = "";
        editButton.textContent = "Edit site rule";
        editButton.addEventListener("click", editMatchingRule);
      }
      return;
    }

    container.style.display = "";
    setSiteControlStatus(`Media Hotkeys enabled on ${hostPattern}`);
    button.textContent = `Disable on ${hostPattern}`;
    button.addEventListener("click", () => {
      void persistSitePolicies(
        addOrReplaceSitePolicy({
          pattern: hostPattern,
          policy: "disabled",
          embedsPolicy: "inherit",
        }),
        `Disabled on ${hostPattern}`,
      );
    });
  } catch {
    setUnavailableSiteControls();
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

    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
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

  (document.getElementById("hotkeysEnabled") as HTMLInputElement).checked =
    currentSettings.quickSettings.hotkeysEnabled;
  renderActionKeyBindingsTable();
}

async function handleAdvancedSettings(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  (document.getElementById("hotkeysEnabled") as HTMLInputElement).checked =
    currentSettings.quickSettings.hotkeysEnabled;
  renderActionKeyBindingsTable();
  void renderSiteControls();

  document.getElementById("hotkeysEnabled")?.addEventListener("change", () => {
    const hotkeysEnabled = (document.getElementById("hotkeysEnabled") as HTMLInputElement).checked;
    const nextSettings = structuredClone(currentSettings);
    nextSettings.quickSettings.hotkeysEnabled = hotkeysEnabled;
    void persistSettings(nextSettings, {
      successMessage: hotkeysEnabled ? "Hotkeys enabled" : "Hotkeys disabled",
    });
  });
  document.getElementById("reset")?.addEventListener("click", () => {
    void handleReset();
  });
  document.getElementById("advanced-settings")?.addEventListener("click", () => {
    void handleAdvancedSettings();
  });
}

void init().catch(() => {
  showAnnouncement(
    "Failed to load quick settings. Try reinstalling the extension or restarting the browser.",
    "error",
  );
});
