import browser from "webextension-polyfill";
import { confirmWithDialog } from "./confirm-dialog.js";
import { collectAdvancedSettings, populateAdvancedSettings } from "./advanced-settings.js";
import { DELETE } from "./icons.js";
import {
  DEFAULT_ADVANCED_SETTINGS,
  diffSettings,
  findMatchingSitePolicy,
  getSettings,
  saveSettings,
  type ExtensionSettings,
  type SitePolicy,
  type SitePolicyEmbedsPolicy,
  type SitePolicyMode,
} from "./storage.js";
import { normalizeDisabledUrlPattern, normalizeSitePolicies } from "./site-patterns.js";
import { showStatusToast, type StatusToastTone } from "./status-toast.js";

// The settings as this page last knew them, kept current by the user's own edits and by
// `storage.onChanged`. Saves send only the difference to it, never the whole object.
let currentSettings: ExtensionSettings;
let localEditCount = 0;
let latestRefreshNumber = 0;
let changedBeforeLoad = false;
let showStoredSettingsNext = false;
let siteRuleRefreshDeferred = false;
let pendingSave: Promise<void> = Promise.resolve();
let debouncedInputSaveId: number | undefined;

const INPUT_SAVE_DEBOUNCE_MS = 500;
const DISABLED_SITE_PREFILL_PARAM = "disabledSitePrefill";
const DISABLED_SITE_HIGHLIGHT_URL_PARAM = "highlightDisabledSiteUrl";
const NEW_ISSUE_URL = "https://github.com/jaredbcook/media-hotkeys/issues/new";

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

  const update = diffSettings(currentSettings, settingsToPersist);
  if (!update) {
    return pendingSave;
  }

  currentSettings = settingsToPersist;
  localEditCount += 1;
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      try {
        await saveSettings(update);
        showStatus();
      } catch {
        showStatus("Failed to save settings. Try again.", "error");
        // The snapshot already holds the edit, which may not be stored (or only partly). Show
        // what storage has, so the page doesn't claim a save that never happened.
        showStoredSettingsNext = true;
        void refreshFromStorage().catch(() => undefined);
      }
    });

  return pendingSave;
}

function isEditingSitePolicies(): boolean {
  // Typing in a rule row (a pending debounce) or merely resting focus in the list. Replacing the
  // rows takes focus away, which is only worth it to drop an edit that failed to save.
  return (
    getSitePoliciesList().contains(document.activeElement) &&
    (debouncedInputSaveId !== undefined || !showStoredSettingsNext)
  );
}

/** Replaces the rule rows with storage's, keeping the new rows the user hasn't filled in yet. */
function renderStoredSitePolicies(settings: ExtensionSettings): void {
  const blankRows = Array.from(
    document.querySelectorAll<HTMLTableRowElement>(".site-policy-row"),
  ).filter((row) => row.querySelector<HTMLInputElement>(".site-policy-pattern")?.value === "");
  renderSitePoliciesList({ focusTarget: false, settings });
  getSitePoliciesList().append(...blankRows);
}

/**
 * Picks up settings changed elsewhere (the popup, the overlay hotkey), so a field the user didn't
 * touch keeps matching storage and the next save sends only what they changed. It waits for this
 * page's own saves, and skips a read that a newer read or a newer edit overtook: that edit's own
 * save announces itself. After a failed save (`showStoredSettingsNext`) it also replaces the focused
 * rule row, so the edit that was not saved is not left on screen; that intent lasts until a read
 * has applied it.
 */
async function refreshFromStorage(): Promise<void> {
  latestRefreshNumber += 1;
  const refreshNumber = latestRefreshNumber;
  const editsBefore = localEditCount;
  await pendingSave;
  const latestSettings = await getSettings();
  const overtaken = refreshNumber !== latestRefreshNumber || localEditCount !== editsBefore;
  if (overtaken) {
    return;
  }

  const changes = diffSettings(currentSettings, latestSettings);
  const nextSettings = { ...latestSettings };
  let keepShowingStoredSettings = false;

  if (changes?.advancedSettings) {
    // Fields the user has typed in since the last save keep their text, and the next save sends it
    // as their change. The rest, including a focused field whose edit failed to save, show storage.
    const fields = getEditableInputs();
    const typedValues = fields.map((input) => input.value);
    populateAdvancedSettings(currentSettings.advancedSettings);
    const savedValues = fields.map((input) => input.value);
    populateAdvancedSettings(latestSettings.advancedSettings);
    fields.forEach((input, index) => {
      rememberValidInputValue(input);
      if (typedValues[index] !== savedValues[index]) {
        input.value = typedValues[index];
      }
    });
  }

  if (changes?.siteSettings) {
    // Site rules are one stored list that the page saves whole, so rows being edited are not
    // replaced; saving them then overwrites a list changed elsewhere meanwhile. The refresh is
    // retried when focus leaves the list.
    if (isEditingSitePolicies()) {
      nextSettings.siteSettings = currentSettings.siteSettings;
      siteRuleRefreshDeferred = true;
      keepShowingStoredSettings = showStoredSettingsNext;
    } else {
      renderStoredSitePolicies(latestSettings);
    }
  }

  showStoredSettingsNext = keepShowingStoredSettings;
  currentSettings = nextSettings;
}

function handleStorageChanged(_changes: unknown, areaName: string): void {
  if (areaName !== "sync") {
    return;
  }

  if (!currentSettings) {
    // The first read may have started before this change; init reads again once it has loaded.
    changedBeforeLoad = true;
    return;
  }

  void refreshFromStorage().catch(() => undefined);
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
  const step = Number(input.step);
  const wholeValue = Number.isInteger(step) && step >= 1 ? Math.round(parsedValue) : parsedValue;
  const clampedValue = Math.min(Math.max(wholeValue, min), max);

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

function renderSitePoliciesList(
  options: { focusTarget: boolean; settings: ExtensionSettings } = {
    focusTarget: true,
    settings: currentSettings,
  },
): void {
  const searchParams = new URLSearchParams(window.location.search);
  const prefill = searchParams.get(DISABLED_SITE_PREFILL_PARAM);
  const highlightUrl = searchParams.get(DISABLED_SITE_HIGHLIGHT_URL_PARAM);
  const highlightedPattern = highlightUrl
    ? findMatchingSitePolicy(highlightUrl, options.settings.siteSettings)?.pattern
    : undefined;

  const list = getSitePoliciesList();
  const policies = normalizeSitePolicies(options.settings.siteSettings.sitePolicies);

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
  if (targetPattern && options.focusTarget) {
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
  const confirmed = await confirmWithDialog({
    title: "Restore default advanced settings?",
    message:
      "Every setting on this page except your site policies will be reset to its default. This can't be undone.",
    confirmLabel: "Restore Defaults",
  });
  if (!confirmed) {
    return;
  }

  const nextSettings = structuredClone(currentSettings);
  nextSettings.advancedSettings = structuredClone(DEFAULT_ADVANCED_SETTINGS);
  populateAdvancedSettings(nextSettings.advancedSettings);
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }
  await persistSettings(nextSettings);
}

function getReportIssueUrl(version: string): string {
  const url = new URL(NEW_ISSUE_URL);
  url.searchParams.set("template", "bug.md");
  url.searchParams.set(
    "body",
    [
      "## What happens",
      "",
      "## What should happen",
      "",
      "## Steps to reproduce",
      "",
      "<!-- Browser and version, the page or site, and the keys pressed. -->",
      "",
      "## Version",
      "",
      `Media Hotkeys ${version}`,
      "",
    ].join("\n"),
  );
  return url.href;
}

function renderVersionAndReportLink(): void {
  const { version } = browser.runtime.getManifest();
  const versionLabel = document.getElementById("extension-version");
  if (versionLabel) {
    versionLabel.textContent = `v${version}`;
  }

  const reportIssueLink = document.getElementById("report-issue-link") as HTMLAnchorElement | null;
  if (reportIssueLink) {
    reportIssueLink.href = getReportIssueUrl(version);
  }
}

async function init(): Promise<void> {
  renderVersionAndReportLink();
  browser.storage.onChanged.addListener(handleStorageChanged);
  currentSettings = await getSettings();
  populateAdvancedSettings(currentSettings.advancedSettings);
  renderSitePoliciesList();
  for (const input of getEditableInputs()) {
    rememberValidInputValue(input);
  }
  if (changedBeforeLoad) {
    void refreshFromStorage().catch(() => undefined);
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
  getSitePoliciesList().addEventListener("focusout", () => {
    if (siteRuleRefreshDeferred) {
      siteRuleRefreshDeferred = false;
      void refreshFromStorage().catch(() => undefined);
    }
  });
  document.getElementById("add-site-policy")?.addEventListener("click", () => {
    handleAddSitePolicy();
  });
}

void init();
