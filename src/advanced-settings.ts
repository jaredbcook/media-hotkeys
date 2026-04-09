import {
  type ExtensionSettings,
  type AdvancedSettings,
  type OverlayPosition,
  type SkipOverlayPosition,
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

const SKIP_OVERLAY_POSITION_OPTIONS: SkipOverlayPosition[] = ["left / right", "same as others"];

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

function fillSkipOverlayPositionSelect(
  select: HTMLSelectElement,
  selectedValue: SkipOverlayPosition,
): void {
  select.innerHTML = "";

  for (const value of SKIP_OVERLAY_POSITION_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selectedValue;
    select.appendChild(option);
  }
}

export function populateAdvancedSettings(settings: ExtensionSettings["advancedSettings"]): void {
  (document.getElementById("volumeStep") as HTMLInputElement).value = String(
    settings.volumeStep * 100,
  );
  (document.getElementById("speedMin") as HTMLInputElement).value = String(settings.speedMin);
  (document.getElementById("speedMax") as HTMLInputElement).value = String(settings.speedMax);
  (document.getElementById("speedStep") as HTMLInputElement).value = String(settings.speedStep);
  (document.getElementById("seekStepSmall") as HTMLInputElement).value = String(
    settings.seekStepSmall,
  );
  (document.getElementById("seekStepMedium") as HTMLInputElement).value = String(
    settings.seekStepMedium,
  );
  (document.getElementById("seekStepLarge") as HTMLInputElement).value = String(
    settings.seekStepLarge,
  );
  (document.getElementById("useNumberKeysToJump") as HTMLInputElement).checked =
    settings.useNumberKeysToJump;
  (document.getElementById("sumQuickSkips") as HTMLInputElement).checked = settings.sumQuickSkips;
  (document.getElementById("showOverlays") as HTMLInputElement).checked = settings.showOverlays;
  fillOverlayPositionSelect(
    document.getElementById("overlayPosition") as HTMLSelectElement,
    settings.overlayPosition,
  );
  fillSkipOverlayPositionSelect(
    document.getElementById("skipOverlayPosition") as HTMLSelectElement,
    settings.skipOverlayPosition,
  );
  (document.getElementById("overlayVisibleDuration") as HTMLInputElement).value = String(
    settings.overlayVisibleDuration,
  );
  (document.getElementById("overlayFadeDuration") as HTMLInputElement).value = String(
    settings.overlayFadeDuration,
  );
  (document.getElementById("debugLogging") as HTMLInputElement).checked = settings.debugLogging;
}

export function collectAdvancedSettings(): AdvancedSettings {
  return {
    volumeStep:
      parseInt((document.getElementById("volumeStep") as HTMLInputElement).value, 10) / 100,
    speedMin: parseFloat((document.getElementById("speedMin") as HTMLInputElement).value),
    speedMax: parseFloat((document.getElementById("speedMax") as HTMLInputElement).value),
    speedStep: parseFloat((document.getElementById("speedStep") as HTMLInputElement).value),
    seekStepSmall: parseFloat((document.getElementById("seekStepSmall") as HTMLInputElement).value),
    seekStepMedium: parseFloat(
      (document.getElementById("seekStepMedium") as HTMLInputElement).value,
    ),
    seekStepLarge: parseFloat((document.getElementById("seekStepLarge") as HTMLInputElement).value),
    useNumberKeysToJump: (document.getElementById("useNumberKeysToJump") as HTMLInputElement)
      .checked,
    sumQuickSkips: (document.getElementById("sumQuickSkips") as HTMLInputElement).checked,
    showOverlays: (document.getElementById("showOverlays") as HTMLInputElement).checked,
    overlayPosition: (document.getElementById("overlayPosition") as HTMLSelectElement)
      .value as OverlayPosition,
    skipOverlayPosition: (document.getElementById("skipOverlayPosition") as HTMLSelectElement)
      .value as SkipOverlayPosition,
    overlayVisibleDuration: parseInt(
      (document.getElementById("overlayVisibleDuration") as HTMLInputElement).value,
      10,
    ),
    overlayFadeDuration: parseInt(
      (document.getElementById("overlayFadeDuration") as HTMLInputElement).value,
      10,
    ),
    debugLogging: (document.getElementById("debugLogging") as HTMLInputElement).checked,
  };
}
