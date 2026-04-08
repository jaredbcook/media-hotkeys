import {
  actionSupportsOverlay,
  type MediaAction,
  type OverlayPosition,
  type ExtensionSettings,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
} from "./storage.js";

const ACTION_LABELS: Record<MediaAction, string> = {
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
  seekToPercent0: "Jump to 0%",
  seekToPercent10: "Jump to 10%",
  seekToPercent20: "Jump to 20%",
  seekToPercent30: "Jump to 30%",
  seekToPercent40: "Jump to 40%",
  seekToPercent50: "Jump to 50%",
  seekToPercent60: "Jump to 60%",
  seekToPercent70: "Jump to 70%",
  seekToPercent80: "Jump to 80%",
  seekToPercent90: "Jump to 90%",
};

const ACTION_ORDER: MediaAction[] = Object.keys(ACTION_LABELS) as MediaAction[];

const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: "\u25B2",
  ArrowDown: "\u25BC",
  ArrowLeft: "\u25C0",
  ArrowRight: "\u25B6",
  " ": "Space",
};

function displayKey(key: string): string {
  return KEY_DISPLAY[key] ?? key;
}

const KEY_ACCESSIBLE_LABELS: Record<string, string> = {
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
};

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

let currentSettings: ExtensionSettings;
let activeKeyCaptureCleanup: (() => void) | undefined;
let pendingSave: Promise<void> = Promise.resolve();

function fillOverlayPositionSelect(
  select: HTMLSelectElement,
  selectedValue: OverlayPosition,
): void {
  select.innerHTML = "";

  for (const pos of [
    "top-left",
    "top",
    "top-right",
    "center-left",
    "center",
    "center-right",
    "bottom-left",
    "bottom",
    "bottom-right",
  ] as OverlayPosition[]) {
    const option = document.createElement("option");
    option.value = pos;
    option.textContent = pos.replace(/-/g, " ");
    option.selected = pos === selectedValue;
    select.appendChild(option);
  }
}

function findActionForKey(key: string, excludeAction?: MediaAction): MediaAction | undefined {
  for (const [action, config] of Object.entries(currentSettings.actions)) {
    if (action === excludeAction) continue;
    if (config.keys.includes(key)) return action as MediaAction;
  }
  return undefined;
}

function removeKeyFromAction(action: MediaAction, key: string): void {
  const config = currentSettings.actions[action];
  config.keys = config.keys.filter((k) => k !== key);
  announce(`${accessibleKeyLabel(key)} removed from ${ACTION_LABELS[action]}.`);
  renderActionsTable();
  void persistSettings();
}

function setAddButtonIdleState(button: HTMLButtonElement, action: MediaAction): void {
  button.classList.remove("listening");
  button.innerHTML = `<span aria-hidden="true">+</span>`;
  button.setAttribute("aria-label", `Add shortcut key for ${ACTION_LABELS[action]} action`);
}

function announce(message: string): void {
  const announcements = document.getElementById("announcements");
  if (!announcements) return;

  announcements.textContent = "";
  window.setTimeout(() => {
    announcements.textContent = message;
  }, 0);
}

function clearActiveKeyCapture(): void {
  activeKeyCaptureCleanup?.();
  activeKeyCaptureCleanup = undefined;
}

function startKeyCapture(action: MediaAction, button: HTMLButtonElement): void {
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

    // Ignore modifier-only keys
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;

    const key = e.shiftKey && e.key !== "Shift" ? e.key : e.key;
    const conflict = findActionForKey(key, action);

    if (conflict) {
      // Auto-remove from conflicting action
      const conflictConfig = currentSettings.actions[conflict];
      conflictConfig.keys = conflictConfig.keys.filter((k) => k !== key);
    }

    if (!currentSettings.actions[action].keys.includes(key)) {
      currentSettings.actions[action].keys.push(key);
    }

    clearActiveKeyCapture();
    const keyLabel = accessibleKeyLabel(key);
    const conflictMessage = conflict
      ? ` ${keyLabel} was removed from ${ACTION_LABELS[conflict]}.`
      : "";
    announce(`${keyLabel} assigned to ${ACTION_LABELS[action]}.${conflictMessage}`);
    renderActionsTable();
    void persistSettings();
  };

  document.addEventListener("keydown", handler, true);
  activeKeyCaptureCleanup = () => {
    document.removeEventListener("keydown", handler, true);
    setAddButtonIdleState(button, action);
  };
}

function renderActionsTable(): void {
  const tbody = document.getElementById("actions-body") as HTMLTableSectionElement;
  tbody.innerHTML = "";
  const overlayVisibility = currentSettings.overlayVisibility;
  const perActionVisibilityEnabled = overlayVisibility === "Custom";
  const globalOverlayPosition = currentSettings.overlayPosition;

  for (const action of ACTION_ORDER) {
    const config = currentSettings.actions[action];
    const tr = document.createElement("tr");
    const actionLabel = ACTION_LABELS[action];
    const actionId = `action-${action}`;

    // Action label
    const tdLabel = document.createElement("th");
    tdLabel.id = actionId;
    tdLabel.textContent = actionLabel;
    tdLabel.scope = "row";
    tr.appendChild(tdLabel);

    // Key chips
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
      removeBtn.addEventListener("click", () => removeKeyFromAction(action, key));

      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "add-key-button";
    addBtn.type = "button";
    setAddButtonIdleState(addBtn, action);
    addBtn.addEventListener("click", () => startKeyCapture(action, addBtn));
    chipsContainer.appendChild(addBtn);

    tdKeys.appendChild(chipsContainer);
    tr.appendChild(tdKeys);

    const tdOverlay = document.createElement("td");
    const tdPosition = document.createElement("td");

    if (actionSupportsOverlay(action)) {
      const checkbox = document.createElement("input");
      const checkboxId = `${action}-overlay-visible`;
      const positionId = `${action}-overlay-position`;
      checkbox.type = "checkbox";
      checkbox.id = checkboxId;
      checkbox.setAttribute("aria-labelledby", actionId);
      checkbox.setAttribute("aria-label", `Show overlay for ${actionLabel}`);
      checkbox.checked = perActionVisibilityEnabled
        ? (config.overlayVisible ?? true)
        : overlayVisibility === "All";
      checkbox.disabled = !perActionVisibilityEnabled;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          delete currentSettings.actions[action].overlayVisible;
        } else {
          currentSettings.actions[action].overlayVisible = false;
        }
        void persistSettings();
      });
      tdOverlay.appendChild(checkbox);

      const select = document.createElement("select");
      select.id = positionId;
      select.className = "overlay-position-select";
      select.setAttribute("aria-labelledby", actionId);
      select.setAttribute("aria-label", `Overlay position for ${actionLabel}`);
      select.disabled = !perActionVisibilityEnabled;
      fillOverlayPositionSelect(select, config.overlayPosition ?? globalOverlayPosition);
      select.addEventListener("change", () => {
        const nextValue = select.value as OverlayPosition;
        if (nextValue === currentSettings.overlayPosition) {
          delete currentSettings.actions[action].overlayPosition;
        } else {
          currentSettings.actions[action].overlayPosition = nextValue;
        }
        void persistSettings();
      });
      tdPosition.appendChild(select);
    } else {
      tdOverlay.innerHTML = `<span class="screen-reader">Overlay not supported</span>`;
      tdPosition.innerHTML = `<span class="screen-reader">Overlay not supported</span>`;
      tdOverlay.className = "overlay-unavailable";
      tdPosition.className = "overlay-unavailable";
    }

    tr.appendChild(tdOverlay);
    tr.appendChild(tdPosition);

    tbody.appendChild(tr);
  }
}

function syncGlobalControls(): void {
  const debugLogging = document.getElementById("debugLogging") as HTMLInputElement | null;
  if (!debugLogging) {
    return;
  }

  debugLogging.checked = currentSettings.debugLogging;
}

function showStatus(): void {
  const status = document.getElementById("status")!;
  status.textContent = "Settings saved.";
  status.classList.add("visible");
  setTimeout(() => status.classList.remove("visible"), 2000);
}

function persistSettings(): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await saveSettings(nextSettings);
      showStatus();
    });

  return pendingSave;
}

async function handleDebugLoggingChange(event: Event): Promise<void> {
  currentSettings.debugLogging = (event.currentTarget as HTMLInputElement).checked;
  await persistSettings();
}

async function handleReset(): Promise<void> {
  currentSettings.actions = structuredClone(DEFAULT_SETTINGS.actions);
  currentSettings.debugLogging = DEFAULT_SETTINGS.debugLogging;
  syncGlobalControls();
  renderActionsTable();
  await persistSettings();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  syncGlobalControls();
  renderActionsTable();

  document.getElementById("debugLogging")?.addEventListener("change", handleDebugLoggingChange);
  document.getElementById("reset")?.addEventListener("click", handleReset);
}

init();
