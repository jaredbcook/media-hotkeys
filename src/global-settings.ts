import {
  type ExtensionSettings,
  type GlobalSettings,
  type OverlayPosition,
  type OverlayVisibility,
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

export function populateGlobalSettings(
  settings: Pick<ExtensionSettings, keyof GlobalSettings>,
): void {
  (document.getElementById("volumeStep") as HTMLInputElement).value = String(settings.volumeStep);
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
  fillOverlayVisibilitySelect(
    document.getElementById("overlayVisibility") as HTMLSelectElement,
    settings.overlayVisibility,
  );
  fillOverlayPositionSelect(
    document.getElementById("overlayPosition") as HTMLSelectElement,
    settings.overlayPosition,
  );
  (document.getElementById("overlayVisibleDuration") as HTMLInputElement).value = String(
    settings.overlayVisibleDuration,
  );
  (document.getElementById("overlayFadeDuration") as HTMLInputElement).value = String(
    settings.overlayFadeDuration,
  );
}

export function collectGlobalSettings(): GlobalSettings {
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
