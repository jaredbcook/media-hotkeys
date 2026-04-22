import { collectAdvancedSettings, populateAdvancedSettings } from "./advanced-settings.js";
import { DELETE } from "./icons.js";
import {
  DEFAULT_ADVANCED_SETTINGS,
  findMatchingSitePolicy,
  getSettings,
  normalizeDisabledUrlPattern,
  normalizeSitePolicies,
  saveSettings,
  settingsEqual,
  type ExtensionSettings,
  type SitePolicy,
  type SitePolicyEmbedsPolicy,
  type SitePolicyMode,
} from "./storage.js";
import { showStatusToast, type StatusToastTone } from "./status-toast.js";

let currentSettings: ExtensionSettings;
let pendingSave: Promise<void> = Promise.resolve();
let debouncedInputSaveId: number | undefined;

const INPUT_SAVE_DEBOUNCE_MS = 500;
const DISABLED_SITE_PREFILL_PARAM = "disabledSitePrefill";
const DISABLED_SITE_HIGHLIGHT_URL_PARAM = "highlightDisabledSiteUrl";

function showStatus(message = "Settings saved.", tone: StatusToastTone = "success"): void {
  showStatusToast(message, tone);
}

function persistSettings(nextSettings?: ExtensionSettings): Promise<void> {
  if (!normalizeEditableInputsForSave()) {
    return pendingSave;
  }

  const settingsToPersist = nextSettings ?? {
    ...currentSettings,
    advancedSettings: collectAdvancedSettings(),
  };

  if (settingsEqual(currentSettings, settingsToPersist)) {
    return pendingSave;
  }

  currentSettings = settingsToPersist;
  const settingsToSave = structuredClone(settingsToPersist);
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      await saveSettings(settingsToSave);
      showStatus();
    });

  return pendingSave;
}

function isDebouncedTextInput(input: HTMLInputElement): boolean {
  return input.type === "number" || input.type === "text";
}

function getEditableInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) => isDebouncedTextInput(input) && !input.closest("#site-policies-list"),
  );
}

function rememberValidInputValue(input: HTMLInputElement): void {
  input.dataset.lastValidValue = input.value;
}

function revertToLastValidInputValue(input: HTMLInputElement): void {
  input.value = input.dataset.lastValidValue ?? input.defaultValue;
}

function getClampedNumberInputValue(input: HTMLInputElement): string | undefined {
  if (input.value.trim() === "") {
    return undefined;
  }

  const parsedValue = input.valueAsNumber;
  if (Number.isNaN(parsedValue)) {
    return undefined;
  }

  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  const clampedValue = Math.min(Math.max(parsedValue, min), max);

  return String(clampedValue);
}

function normalizeEditableInput(input: HTMLInputElement): boolean {
  if (input.value.trim() === "") {
    return false;
  }

  if (input.type === "number") {
    const clampedValue = getClampedNumberInputValue(input);
    if (clampedValue === undefined) {
      return false;
    }

    input.value = clampedValue;
  }

  rememberValidInputValue(input);
  return true;
}

function normalizeEditableInputsForSave(): boolean {
  return getEditableInputs().every((input) => normalizeEditableInput(input));
}

function clearDebouncedInputSave(): void {
  if (debouncedInputSaveId === undefined) {
    return;
  }

  window.clearTimeout(debouncedInputSaveId);
  debouncedInputSaveId = undefined;
}

function scheduleDebouncedInputSave(): void {
  clearDebouncedInputSave();
  debouncedInputSaveId = window.setTimeout(() => {
    debouncedInputSaveId = undefined;
    void persistSettings();
  }, INPUT_SAVE_DEBOUNCE_MS);
}

function handleEditableInput(input: HTMLInputElement): void {
  if (input.value.trim() === "") {
    clearDebouncedInputSave();
    return;
  }

  scheduleDebouncedInputSave();
}

function handleEditableInputBlur(input: HTMLInputElement): void {
  clearDebouncedInputSave();

  if (!normalizeEditableInput(input)) {
    revertToLastValidInputValue(input);
    return;
  }

  void persistSettings();
}

function getSitePoliciesList(): HTMLTableSectionElement {
  return document.getElementById("site-policies-list") as HTMLTableSectionElement;
}

function getSitePoliciesError(): HTMLDivElement {
  return document.getElementById("site-policies-error") as HTMLDivElement;
}

function clearSitePoliciesError(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>(".site-policy-pattern")) {
    input.removeAttribute("aria-invalid");
  }
  const error = getSitePoliciesError();
  if (error) {
    error.textContent = "";
  }
}

function setSitePoliciesError(message: string, input?: HTMLInputElement): void {
  input?.setAttribute("aria-invalid", "true");
  const error = getSitePoliciesError();
  if (error) {
    error.textContent = message;
  }
}

function clearDisabledSiteRouteParams(): void {
  const url = new URL(window.location.href);
  if (
    !url.searchParams.has(DISABLED_SITE_PREFILL_PARAM) &&
    !url.searchParams.has(DISABLED_SITE_HIGHLIGHT_URL_PARAM)
  ) {
    return;
  }

  url.searchParams.delete(DISABLED_SITE_PREFILL_PARAM);
  url.searchParams.delete(DISABLED_SITE_HIGHLIGHT_URL_PARAM);
  window.history.replaceState({}, "", url.href);
}

function getSitePolicyInputLabel(policy: SitePolicy): string {
  return policy.pattern || "new site policy";
}

function scheduleSitePoliciesSave(): void {
  clearDebouncedInputSave();
  debouncedInputSaveId = window.setTimeout(() => {
    debouncedInputSaveId = undefined;
    void persistSitePolicies();
  }, INPUT_SAVE_DEBOUNCE_MS);
}

function handleSitePolicyPatternInput(input: HTMLInputElement): void {
  clearSitePoliciesError();

  if (input.value.trim() === "") {
    clearDebouncedInputSave();
    return;
  }

  scheduleSitePoliciesSave();
}

function handleSitePolicyPatternBlur(input: HTMLInputElement): void {
  clearDebouncedInputSave();

  if (input.value.trim() === "") {
    revertToLastValidInputValue(input);
    return;
  }

  void persistSitePolicies();
}

function createSitePolicyRow(policy: SitePolicy): HTMLTableRowElement {
  const tableRow = document.createElement("tr");
  tableRow.className = "site-policy-row";
  tableRow.dataset.pattern = policy.pattern;

  const patternCell = document.createElement("td");
  const policyCell = document.createElement("td");
  const embedsCell = document.createElement("td");
  const actionsCell = document.createElement("td");

  const patternInput = document.createElement("input");
  patternInput.type = "text";
  patternInput.className = "site-policy-pattern";
  patternInput.value = policy.pattern;
  patternInput.placeholder = "example.com or example.com/path";
  patternInput.setAttribute("aria-label", "Site policy URL");
  rememberValidInputValue(patternInput);
  patternInput.addEventListener("input", () => {
    handleSitePolicyPatternInput(patternInput);
  });
  patternInput.addEventListener("blur", () => {
    handleSitePolicyPatternBlur(patternInput);
  });
  patternCell.appendChild(patternInput);

  const modeSelect = document.createElement("select");
  modeSelect.className = "site-policy-mode";
  modeSelect.setAttribute("aria-label", "Page policy");
  for (const [value, label] of [
    ["disabled", "Disabled"],
    ["enabled", "Enabled"],
  ] as [SitePolicyMode, string][]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  }
  modeSelect.value = policy.policy;
  modeSelect.addEventListener("input", () => {
    void persistSitePolicies();
  });
  policyCell.appendChild(modeSelect);

  const embedsSelect = document.createElement("select");
  embedsSelect.className = "site-policy-embeds-policy";
  embedsSelect.setAttribute("aria-label", "Embeds policy");
  for (const [value, label] of [
    ["inherit", "Inherit"],
    ["ignore", "Ignore"],
  ] as [SitePolicyEmbedsPolicy, string][]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    embedsSelect.appendChild(option);
  }
  embedsSelect.value = policy.embedsPolicy;
  embedsSelect.addEventListener("input", () => {
    void persistSitePolicies();
  });
  embedsCell.appendChild(embedsSelect);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-button";
  deleteButton.innerHTML = `<span class="delete-icon" aria-hidden="true">${DELETE}</span>`;
  deleteButton.setAttribute(
    "aria-label",
    `Delete site policy for ${getSitePolicyInputLabel(policy)}`,
  );
  deleteButton.addEventListener("click", () => {
    tableRow.remove();
    clearSitePoliciesError();
    void persistSitePolicies();
  });
  actionsCell.appendChild(deleteButton);

  tableRow.append(patternCell, policyCell, embedsCell, actionsCell);
  return tableRow;
}

function renderSitePoliciesList(): void {
  const searchParams = new URLSearchParams(window.location.search);
  const prefill = searchParams.get(DISABLED_SITE_PREFILL_PARAM);
  const highlightUrl = searchParams.get(DISABLED_SITE_HIGHLIGHT_URL_PARAM);
  const highlightedPattern = highlightUrl
    ? findMatchingSitePolicy(highlightUrl, currentSettings.siteSettings)?.pattern
    : undefined;

  const list = getSitePoliciesList();
  const policies = normalizeSitePolicies(currentSettings.siteSettings.sitePolicies);

  let prefillPattern: string | undefined;
  if (prefill) {
    prefillPattern = normalizeDisabledUrlPattern(prefill) ?? prefill;
    if (!policies.some((policy) => policy.pattern === prefillPattern)) {
      policies.push({
        pattern: prefillPattern,
        policy: "disabled",
        embedsPolicy: "inherit",
      });
    }
  }

  list.replaceChildren(...policies.map((policy) => createSitePolicyRow(policy)));
  clearSitePoliciesError();

  const targetPattern = prefillPattern || highlightedPattern;
  if (targetPattern) {
    document.getElementById("site-policies-section")?.scrollIntoView();

    const targetRow = Array.from(
      list.querySelectorAll<HTMLTableRowElement>(".site-policy-row"),
    ).find((row) => row.dataset.pattern === targetPattern);
    if (targetRow) {
      const input = targetRow.querySelector<HTMLInputElement>(".site-policy-pattern");
      input?.focus();
      input?.select();
    }
  }
}

function collectSitePolicies(): SitePolicy[] | null {
  clearSitePoliciesError();
  const policies: Partial<SitePolicy>[] = [];

  for (const row of document.querySelectorAll<HTMLTableRowElement>(".site-policy-row")) {
    const patternInput = row.querySelector<HTMLInputElement>(".site-policy-pattern");
    const modeSelect = row.querySelector<HTMLSelectElement>(".site-policy-mode");
    const embedsPolicySelect = row.querySelector<HTMLSelectElement>(".site-policy-embeds-policy");
    const rawPattern = patternInput?.value.trim() ?? "";
    if (rawPattern === "") {
      continue;
    }

    const normalizedPattern = normalizeDisabledUrlPattern(rawPattern);
    if (!normalizedPattern) {
      setSitePoliciesError(
        `Invalid site pattern: "${rawPattern}". Use example.com or example.com/path.`,
        patternInput ?? undefined,
      );
      return null;
    }

    if (patternInput) {
      patternInput.value = normalizedPattern;
      rememberValidInputValue(patternInput);
    }
    row.dataset.pattern = normalizedPattern;

    policies.push({
      pattern: normalizedPattern,
      policy: modeSelect?.value as SitePolicyMode,
      embedsPolicy: embedsPolicySelect?.value as SitePolicyEmbedsPolicy,
    });
  }

  return normalizeSitePolicies(policies);
}

async function persistSitePolicies(): Promise<void> {
  clearDisabledSiteRouteParams();

  const sitePolicies = collectSitePolicies();
  if (!sitePolicies || !normalizeEditableInputsForSave()) {
    showStatus("Fix invalid settings before saving.", "error");
    return;
  }

  const nextSettings = {
    ...currentSettings,
    siteSettings: {
      ...currentSettings.siteSettings,
      sitePolicies,
      disabledUrlPatterns: sitePolicies
        .filter((policy) => policy.policy === "disabled")
        .map((policy) => policy.pattern),
    },
  };

  await persistSettings(nextSettings);
}

function handleAddSitePolicy(): void {
  const list = getSitePoliciesList();
  const row = createSitePolicyRow({
    pattern: "",
    policy: "disabled",
    embedsPolicy: "inherit",
  });
  list.append(row);
  row.querySelector<HTMLInputElement>(".site-policy-pattern")?.focus();
}

async function handleReset(): Promise<void> {
  const nextSettings = structuredClone(currentSettings);
  nextSettings.advancedSettings = structuredClone(DEFAULT_ADVANCED_SETTINGS);
  populateAdvancedSettings(nextSettings.advancedSettings);
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }
  await persistSettings(nextSettings);
}

async function init(): Promise<void> {
  currentSettings = await getSettings();
  populateAdvancedSettings(currentSettings.advancedSettings);
  renderSitePoliciesList();
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }

  for (const selector of ["input", "select"]) {
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      selector,
    )) {
      if (element.closest("#site-policies-list")) {
        continue;
      }

      if (element instanceof HTMLInputElement && isDebouncedTextInput(element)) {
        element.addEventListener("input", () => {
          handleEditableInput(element);
        });
        element.addEventListener("blur", () => {
          handleEditableInputBlur(element);
        });
        continue;
      }

      const eventName =
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
          ? "change"
          : "input";
      element.addEventListener(eventName, () => {
        void persistSettings();
      });
    }
  }

  document.getElementById("reset")?.addEventListener("click", () => {
    void handleReset();
  });
  document.getElementById("add-site-policy")?.addEventListener("click", () => {
    handleAddSitePolicy();
  });
}

void init();
