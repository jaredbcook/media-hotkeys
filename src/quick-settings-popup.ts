import browser from "webextension-polyfill";
import {
  type ConfigurableMediaAction,
  type ExtensionSettings,
  DEFAULT_QUICK_SETTINGS,
  getSettings,
  normalizeHotkeyKey,
  saveSettings,
} from "./storage.js";

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
let announcementTimeoutId: number | undefined;
let activeAnnouncement: HTMLDivElement | undefined;
let activeBindingAnnouncement: HTMLDivElement | undefined;
let bindingAnnouncementFrameId: number | undefined;

type AnnouncementTone = "success" | "error";

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

function removeAnnouncement(announcement: HTMLDivElement): void {
  if (activeAnnouncement !== announcement) {
    return;
  }

  window.clearTimeout(announcementTimeoutId);
  announcementTimeoutId = undefined;

  announcement.classList.remove("announcement-visible");

  window.setTimeout(() => {
    if (activeAnnouncement === announcement) {
      announcement.remove();
      activeAnnouncement = undefined;
    }
  }, 240);
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

function showAnnouncement(message: string, tone: AnnouncementTone): void {
  const announcements = getAnnouncementsContainer();
  const liveRegion = getAnnouncementLiveRegion();
  if (!announcements) {
    return;
  }

  if (activeAnnouncement) {
    activeAnnouncement.remove();
    activeAnnouncement = undefined;
  }

  if (announcementTimeoutId !== undefined) {
    window.clearTimeout(announcementTimeoutId);
    announcementTimeoutId = undefined;
  }

  const announcement = document.createElement("div");
  announcement.className = `announcement announcement-${tone}`;
  const content = document.createElement("div");
  content.className = "announcement-content";
  content.textContent = message;
  announcement.appendChild(content);
  announcements.appendChild(announcement);
  activeAnnouncement = announcement;
  if (liveRegion) {
    liveRegion.textContent = message;
  }

  window.requestAnimationFrame(() => {
    announcement.classList.add("announcement-visible");
  });

  announcementTimeoutId = window.setTimeout(() => {
    removeAnnouncement(announcement);
  }, 3000);
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

function persistSettings(options?: {
  successMessage?: string;
  failureMessage?: string;
}): Promise<void> {
  currentSettings.quickSettings.hotkeysEnabled = (
    document.getElementById("hotkeysEnabled") as HTMLInputElement
  ).checked;

  const nextSettings = structuredClone(currentSettings);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      try {
        await saveSettings(nextSettings);
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

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-key-button";
      removeBtn.innerHTML = `<span aria-hidden="true">\u00d7</span>`;
      removeBtn.setAttribute(
        "aria-label",
        `Remove ${accessibleKeyLabel(key)} from ${actionLabel} action`,
      );
      removeBtn.addEventListener("click", () => {
        removeKeyFromAction(action, key);
      });

      chip.appendChild(removeBtn);
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

function removeKeyFromAction(action: ConfigurableMediaAction, key: string): void {
  const config = currentSettings.quickSettings.actionKeyBindings[action];
  const normalizedKey = normalizeHotkeyKey(key);
  config.keys = config.keys.filter(
    (existingKey) => normalizeHotkeyKey(existingKey) !== normalizedKey,
  );
  renderActionKeyBindingsTable();
  announceBindingUpdate(`${accessibleKeyLabel(key)} removed from ${ACTION_LABELS[action]}.`);
  void persistSettings();
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

    if (conflict) {
      const conflictConfig = currentSettings.quickSettings.actionKeyBindings[conflict];
      conflictConfig.keys = conflictConfig.keys.filter(
        (existingKey) => normalizeHotkeyKey(existingKey) !== key,
      );
    }

    if (
      !currentSettings.quickSettings.actionKeyBindings[action].keys.some(
        (existingKey) => normalizeHotkeyKey(existingKey) === key,
      )
    ) {
      currentSettings.quickSettings.actionKeyBindings[action].keys.push(key);
    }

    clearActiveKeyCapture();
    renderActionKeyBindingsTable();

    const keyLabel = accessibleKeyLabel(key);
    const conflictMessage = conflict
      ? ` ${keyLabel} was removed from ${ACTION_LABELS[conflict]}.`
      : "";
    announceBindingUpdate(`${keyLabel} assigned to ${ACTION_LABELS[action]}.${conflictMessage}`);
    void persistSettings();
  };

  document.addEventListener("keydown", handler, true);
  activeKeyCaptureCleanup = () => {
    document.removeEventListener("keydown", handler, true);
    setAddButtonIdleState(button, action);
  };
}

async function handleReset(): Promise<void> {
  currentSettings.quickSettings = structuredClone(DEFAULT_QUICK_SETTINGS);
  (document.getElementById("hotkeysEnabled") as HTMLInputElement).checked =
    currentSettings.quickSettings.hotkeysEnabled;
  renderActionKeyBindingsTable();

  await persistSettings({
    successMessage: "Quick settings reset to default values.",
    failureMessage: "Failed to reset quick settings. Try again.",
  });
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

  document.getElementById("hotkeysEnabled")?.addEventListener("change", () => {
    void persistSettings();
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
