import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/storage.js";

const { getSettingsMock, saveSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn<[], Promise<ExtensionSettings>>(),
  saveSettingsMock: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>("../src/storage.js");
  return {
    ...actual,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
  };
});

function renderOptionsDom(): void {
  document.body.innerHTML = `
    <table><tbody id="actions-body"></tbody></table>
    <input id="debugLogging" type="checkbox" />
    <button id="reset"></button>
    <span id="status"></span>
    <div id="announcements"></div>
  `;
}

const PLAY_PAUSE_LABEL = "Play/Pause";
const MUTE_LABEL = "Mute/Unmute";
const FULLSCREEN_LABEL = "Fullscreen";

function findRowByLabel(label: string): HTMLTableRowElement {
  const rows = Array.from(document.querySelectorAll("#actions-body tr"));
  const row = rows.find((candidate) => candidate.firstElementChild?.textContent === label);
  expect(row).toBeTruthy();
  return row as HTMLTableRowElement;
}

async function loadOptionsModule(settings = structuredClone(DEFAULT_SETTINGS)): Promise<void> {
  vi.resetModules();
  renderOptionsDom();
  getSettingsMock.mockResolvedValue(structuredClone(settings));
  await import("../src/options");
  await Promise.resolve();
}

beforeEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  document.body.innerHTML = "";
});

describe("options screen global setting change handlers", () => {
  it("loads the debug logging checkbox from settings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.debugLogging = false;

    await loadOptionsModule(settings);

    expect((document.getElementById("debugLogging") as HTMLInputElement).checked).toBe(false);
  });

  it("persists debug logging immediately when the checkbox changes", async () => {
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule();

    (document.getElementById("debugLogging") as HTMLInputElement).checked = false;
    document.getElementById("debugLogging")!.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ debugLogging: false }));
    expect(document.getElementById("status")?.textContent).toBe("Settings saved.");
  });

  it("renders per-action overlay controls using the stored global settings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.overlayPosition = "top-left";

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const posSelect = row.querySelector("select") as HTMLSelectElement;
    expect(checkbox.disabled).toBe(false);
    expect(posSelect.value).toBe("top-left");
  });
});

describe("options screen overlay controls", () => {
  it("shows unavailable overlay controls for actions without overlays", async () => {
    await loadOptionsModule();

    const row = findRowByLabel(FULLSCREEN_LABEL);
    const cells = row.querySelectorAll("td");

    expect(cells).toHaveLength(3);
    expect(cells[1]?.textContent).toBe("Overlay not supported");
    expect(cells[2]?.textContent).toBe("Overlay not supported");
    expect(cells[1]?.querySelector("input")).toBeNull();
    expect(cells[2]?.querySelector("select")).toBeNull();
  });

  it("disables per-action overlay visibility when the global mode is not custom", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "None";

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const select = row.querySelector("select") as HTMLSelectElement;

    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
    expect(select.disabled).toBe(true);
  });

  it("unchecking the per-action overlay checkbox sets overlayVisible=false", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    saveSettingsMock.mockResolvedValue(undefined);

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({
          togglePlayPause: expect.objectContaining({ overlayVisible: false }),
        }),
      }),
    );
  });

  it("checking the per-action overlay checkbox deletes the explicit overlayVisible", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.actions.togglePlayPause.overlayVisible = false;
    saveSettingsMock.mockResolvedValue(undefined);

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // checkbox should be unchecked (overlayVisible=false in custom mode)
    expect(checkbox.checked).toBe(false);

    // Check it — should delete the explicit setting
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    // Re-render: now with no explicit setting, default is true
    const updatedRow = findRowByLabel(PLAY_PAUSE_LABEL);
    const updatedCheckbox = updatedRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(updatedCheckbox.checked).toBe(true);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({
          togglePlayPause: expect.not.objectContaining({ overlayVisible: false }),
        }),
      }),
    );
  });

  it("changing the per-action overlay position updates the action's position", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    saveSettingsMock.mockResolvedValue(undefined);

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const select = row.querySelector("select") as HTMLSelectElement;
    select.value = "top-left";
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    // Re-render should show the newly set position
    const updatedRow = findRowByLabel(PLAY_PAUSE_LABEL);
    const updatedSelect = updatedRow.querySelector("select") as HTMLSelectElement;
    expect(updatedSelect.value).toBe("top-left");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({
          togglePlayPause: expect.objectContaining({ overlayPosition: "top-left" }),
        }),
      }),
    );
  });

  it("selecting the global position in the per-action select removes the per-action override", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.overlayPosition = "top-right";
    settings.actions.togglePlayPause.overlayPosition = "bottom-left";
    saveSettingsMock.mockResolvedValue(undefined);

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const select = row.querySelector("select") as HTMLSelectElement;
    // Set it to the global position value to trigger deletion
    select.value = "top-right";
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    // After re-render, inherits global position
    const updatedRow = findRowByLabel(PLAY_PAUSE_LABEL);
    const updatedSelect = updatedRow.querySelector("select") as HTMLSelectElement;
    expect(updatedSelect.value).toBe("top-right");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({
          togglePlayPause: expect.not.objectContaining({ overlayPosition: "bottom-left" }),
        }),
      }),
    );
  });
});

describe("options screen key binding controls", () => {
  it("removes a key chip when the remove button is clicked", async () => {
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule();

    // togglePlayPause has key "k" by default
    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const removeBtn = row.querySelector(".key-chip button") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();

    removeBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const updatedRow = findRowByLabel(PLAY_PAUSE_LABEL);
    expect(updatedRow.querySelectorAll(".key-chip").length).toBe(0);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("starts key capture when the + button is clicked", async () => {
    await loadOptionsModule();

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    addBtn.click();

    expect(addBtn.classList.contains("listening")).toBe(true);
    expect(addBtn.textContent).toContain("Press a key");
  });

  it("cancels key capture when Escape is pressed", async () => {
    await loadOptionsModule();

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(addBtn.classList.contains("listening")).toBe(false);
    expect(addBtn.textContent).toContain("+");
  });

  it("captures a pressed key and adds it to the action", async () => {
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule();

    const row = findRowByLabel(MUTE_LABEL);
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const updatedRow = findRowByLabel(MUTE_LABEL);
    const chips = updatedRow.querySelectorAll(".key-chip");
    const keys = Array.from(chips).map((c) => c.firstChild?.textContent?.trim());
    expect(keys).toContain("z");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("ignores modifier-only keypresses during capture", async () => {
    await loadOptionsModule();

    const row = findRowByLabel(MUTE_LABEL);
    const chipsBefore = row.querySelectorAll(".key-chip").length;
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));

    const updatedRow = findRowByLabel(MUTE_LABEL);
    expect(updatedRow.querySelectorAll(".key-chip").length).toBe(chipsBefore);
    expect(addBtn.classList.contains("listening")).toBe(true);
  });

  it("reassigns a conflicting key to the new action during capture", async () => {
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule();

    // "k" is bound to togglePlayPause; bind it to toggleMute
    const row = findRowByLabel(MUTE_LABEL);
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // togglePlayPause should no longer have "k"
    const playRow = findRowByLabel(PLAY_PAUSE_LABEL);
    const playChips = Array.from(playRow.querySelectorAll(".key-chip")).map((c) =>
      c.firstChild?.textContent?.trim(),
    );
    expect(playChips).not.toContain("k");

    // toggleMute should now have "k"
    const muteRow = findRowByLabel(MUTE_LABEL);
    const muteChips = Array.from(muteRow.querySelectorAll(".key-chip")).map((c) =>
      c.firstChild?.textContent?.trim(),
    );
    expect(muteChips).toContain("k");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("uses accessible names for key and overlay controls", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.actions.togglePlayPause.keys = ["ArrowUp"];

    await loadOptionsModule(settings);

    const row = findRowByLabel(PLAY_PAUSE_LABEL);
    const chipLabel = row.querySelector(".key-chip-label") as HTMLSpanElement;
    const visualArrow = chipLabel.querySelector('[aria-hidden="true"]');
    const srArrow = chipLabel.querySelector(".screen-reader");
    const removeBtn = row.querySelector(".remove-key-button") as HTMLButtonElement;
    const addBtn = row.querySelector(".add-key-button") as HTMLButtonElement;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const select = row.querySelector("select") as HTMLSelectElement;

    expect(visualArrow?.textContent).toBe("▲");
    expect(srArrow?.textContent).toBe("Up Arrow");
    expect(removeBtn.getAttribute("aria-label")).toBe("Remove Up Arrow from Play/Pause action");
    expect(addBtn.getAttribute("aria-label")).toBe("Add shortcut key for Play/Pause action");
    expect(checkbox.getAttribute("aria-label")).toBe("Show overlay for Play/Pause");
    expect(select.getAttribute("aria-label")).toBe("Overlay position for Play/Pause");
  });
});

describe("options screen reset", () => {
  it("clicking reset restores default settings and calls saveSettings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.volumeStep = 0.5;
    settings.debugLogging = false;
    settings.actions.togglePlayPause.keys = ["x"];
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule(settings);

    document.getElementById("reset")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        debugLogging: DEFAULT_SETTINGS.debugLogging,
        volumeStep: 0.5,
        actions: DEFAULT_SETTINGS.actions,
      }),
    );
  });
});
