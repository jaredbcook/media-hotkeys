import {
  actionSupportsOverlay,
  type MediaAction,
  type OverlayPosition,
  type OverlayVisibility,
  type ExtensionSettings,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
} from "./storage.js";

const OVERLAY_POSITIONS: OverlayPosition[] = [
  "top-left",
  "top",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

const OVERLAY_VISIBILITY_OPTIONS: OverlayVisibility[] = ["All", "None", "Custom"];

const ACTION_LABELS: Record<MediaAction, string> = {
  togglePlayPause: "Toggle Play/Pause",
  toggleMute: "Toggle Mute",
  toggleFullscreen: "Toggle Fullscreen",
  togglePip: "Toggle Picture-in-Picture",
  speedUp: "Speed Up",
  slowDown: "Slow Down",
  volumeUp: "Volume Up",
  volumeDown: "Volume Down",
  seekForwardSmall: "Seek Forward (Small)",
  seekBackwardSmall: "Seek Backward (Small)",
  seekForwardMedium: "Seek Forward (Medium)",
  seekBackwardMedium: "Seek Backward (Medium)",
  seekForwardLarge: "Seek Forward (Large)",
  seekBackwardLarge: "Seek Backward (Large)",
  seekToPercent0: "Seek to 0%",
  seekToPercent10: "Seek to 10%",
  seekToPercent20: "Seek to 20%",
  seekToPercent30: "Seek to 30%",
  seekToPercent40: "Seek to 40%",
  seekToPercent50: "Seek to 50%",
  seekToPercent60: "Seek to 60%",
  seekToPercent70: "Seek to 70%",
  seekToPercent80: "Seek to 80%",
  seekToPercent90: "Seek to 90%",
};

const ACTION_ORDER: MediaAction[] = Object.keys(ACTION_LABELS) as MediaAction[];

const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: "\u2191",
  ArrowDown: "\u2193",
  ArrowLeft: "\u2190",
  ArrowRight: "\u2192",
  " ": "Space",
};

function displayKey(key: string): string {
  return KEY_DISPLAY[key] ?? key;
}

let currentSettings: ExtensionSettings;

function fillOverlayPositionSelect(
  select: HTMLSelectElement,
  selectedValue: OverlayPosition,
): void {
  select.innerHTML = "";

  for (const pos of OVERLAY_POSITIONS) {
    const option = document.createElement("option");
    option.value = pos;
    option.textContent = pos.replace(/-/g, " ");
    option.selected = pos === selectedValue;
    select.appendChild(option);
  }
}

function populateGlobalSettings(): void {
  const g = currentSettings;
  (document.getElementById("volumeStep") as HTMLInputElement).value = String(g.volumeStep);
  (document.getElementById("speedMin") as HTMLInputElement).value = String(g.speedMin);
  (document.getElementById("speedMax") as HTMLInputElement).value = String(g.speedMax);
  (document.getElementById("speedStep") as HTMLInputElement).value = String(g.speedStep);
  (document.getElementById("seekStepSmall") as HTMLInputElement).value = String(g.seekStepSmall);
  (document.getElementById("seekStepMedium") as HTMLInputElement).value = String(g.seekStepMedium);
  (document.getElementById("seekStepLarge") as HTMLInputElement).value = String(g.seekStepLarge);
  fillOverlayVisibilitySelect(
    document.getElementById("overlayVisibility") as HTMLSelectElement,
    g.overlayVisibility,
  );
  fillOverlayPositionSelect(
    document.getElementById("overlayPosition") as HTMLSelectElement,
    g.overlayPosition,
  );
  (document.getElementById("overlayVisibleDuration") as HTMLInputElement).value = String(
    g.overlayVisibleDuration,
  );
  (document.getElementById("overlayFadeDuration") as HTMLInputElement).value = String(
    g.overlayFadeDuration,
  );
}

function fillOverlayVisibilitySelect(
  select: HTMLSelectElement,
  selectedValue: OverlayVisibility,
): void {
  select.innerHTML = "";

  for (const value of OVERLAY_VISIBILITY_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selectedValue;
    select.appendChild(option);
  }
}

function collectGlobalSettings(): Omit<ExtensionSettings, "actions"> {
  return {
    volumeStep: parseFloat((document.getElementById("volumeStep") as HTMLInputElement).value),
    speedMin: parseFloat((document.getElementById("speedMin") as HTMLInputElement).value),
    speedMax: parseFloat((document.getElementById("speedMax") as HTMLInputElement).value),
    speedStep: parseFloat((document.getElementById("speedStep") as HTMLInputElement).value),
    seekStepSmall: parseFloat((document.getElementById("seekStepSmall") as HTMLInputElement).value),
    seekStepMedium: parseFloat(
      (document.getElementById("seekStepMedium") as HTMLInputElement).value,
    ),
    seekStepLarge: parseFloat((document.getElementById("seekStepLarge") as HTMLInputElement).value),
    overlayVisibility: (document.getElementById("overlayVisibility") as HTMLSelectElement)
      .value as OverlayVisibility,
    overlayPosition: (document.getElementById("overlayPosition") as HTMLSelectElement)
      .value as OverlayPosition,
    overlayVisibleDuration: parseInt(
      (document.getElementById("overlayVisibleDuration") as HTMLInputElement).value,
      10,
    ),
    overlayFadeDuration: parseInt(
      (document.getElementById("overlayFadeDuration") as HTMLInputElement).value,
      10,
    ),
  };
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
  renderActionsTable();
}

function startKeyCapture(action: MediaAction, button: HTMLButtonElement): void {
  // Deactivate any other active listeners
  document.querySelectorAll(".add-key-btn.listening").forEach((el) => {
    el.classList.remove("listening");
    el.textContent = "+";
  });

  button.classList.add("listening");
  button.textContent = "Press a key\u2026";

  const handler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

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

    document.removeEventListener("keydown", handler, true);
    renderActionsTable();
  };

  document.addEventListener("keydown", handler, true);
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

    // Action label
    const tdLabel = document.createElement("td");
    tdLabel.textContent = ACTION_LABELS[action];
    tr.appendChild(tdLabel);

    // Key chips
    const tdKeys = document.createElement("td");
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "key-chips";

    for (const key of config.keys) {
      const chip = document.createElement("span");
      chip.className = "key-chip";
      chip.textContent = displayKey(key);

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "\u00d7";
      removeBtn.title = "Remove key";
      removeBtn.addEventListener("click", () => removeKeyFromAction(action, key));

      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "add-key-btn";
    addBtn.textContent = "+";
    addBtn.title = "Bind a new key";
    addBtn.addEventListener("click", () => startKeyCapture(action, addBtn));
    chipsContainer.appendChild(addBtn);

    tdKeys.appendChild(chipsContainer);
    tr.appendChild(tdKeys);

    const tdOverlay = document.createElement("td");
    const tdPosition = document.createElement("td");

    if (actionSupportsOverlay(action)) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = perActionVisibilityEnabled
        ? (config.overlayVisible ?? true)
        : overlayVisibility === "All";
      checkbox.disabled = !perActionVisibilityEnabled;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          delete currentSettings.actions[action].overlayVisible;
          return;
        }
        currentSettings.actions[action].overlayVisible = false;
      });
      tdOverlay.appendChild(checkbox);

      const select = document.createElement("select");
      select.className = "overlay-position-select";
      select.disabled = !perActionVisibilityEnabled;
      fillOverlayPositionSelect(select, config.overlayPosition ?? globalOverlayPosition);
      select.addEventListener("change", () => {
        const nextValue = select.value as OverlayPosition;
        if (nextValue === currentSettings.overlayPosition) {
          delete currentSettings.actions[action].overlayPosition;
          return;
        }
        currentSettings.actions[action].overlayPosition = nextValue;
      });
      tdPosition.appendChild(select);
    } else {
      tdOverlay.textContent = "Unavailable";
      tdPosition.textContent = "Unavailable";
      tdOverlay.className = "overlay-unavailable";
      tdPosition.className = "overlay-unavailable";
    }

    tr.appendChild(tdOverlay);
    tr.appendChild(tdPosition);

    tbody.appendChild(tr);
  }
}

function showStatus(): void {
  const status = document.getElementById("status")!;
  status.classList.add("visible");
  setTimeout(() => status.classList.remove("visible"), 2000);
}

async function handleSave(): Promise<void> {
  Object.assign(currentSettings, collectGlobalSettings());
  await saveSettings(currentSettings);
  showStatus();
}

async function handleReset(): Promise<void> {
  currentSettings = structuredClone(DEFAULT_SETTINGS);
  populateGlobalSettings();
  renderActionsTable();
  await saveSettings(currentSettings);
  showStatus();
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateGlobalSettings();
  renderActionsTable();

  document.getElementById("overlayVisibility")?.addEventListener("change", () => {
    currentSettings.overlayVisibility = (
      document.getElementById("overlayVisibility") as HTMLSelectElement
    ).value as OverlayVisibility;
    renderActionsTable();
  });

  document.getElementById("overlayPosition")?.addEventListener("change", () => {
    currentSettings.overlayPosition = (
      document.getElementById("overlayPosition") as HTMLSelectElement
    ).value as OverlayPosition;
    renderActionsTable();
  });

  document.getElementById("save")?.addEventListener("click", handleSave);
  document.getElementById("reset")?.addEventListener("click", handleReset);
}

init();
