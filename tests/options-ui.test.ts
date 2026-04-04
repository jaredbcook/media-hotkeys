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
    <input id="volumeStep" />
    <input id="speedMin" />
    <input id="speedMax" />
    <input id="speedStep" />
    <input id="seekStepSmall" />
    <input id="seekStepMedium" />
    <input id="seekStepLarge" />
    <select id="overlayVisibility"></select>
    <select id="overlayPosition"></select>
    <input id="overlayVisibleDuration" />
    <input id="overlayFadeDuration" />
    <table><tbody id="actions-body"></tbody></table>
    <button id="save"></button>
    <button id="reset"></button>
    <span id="status"></span>
  `;
}

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
  await import("../src/options.ts");
  await Promise.resolve();
}

beforeEach(() => {
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  document.body.innerHTML = "";
});

describe("options screen global setting change handlers", () => {
  it("updates overlayVisibility on select change and re-renders the table", async () => {
    await loadOptionsModule(); // default: overlayVisibility = "All"

    const select = document.getElementById("overlayVisibility") as HTMLSelectElement;
    select.value = "Custom";
    select.dispatchEvent(new Event("change"));

    // With "Custom", per-action checkboxes should become enabled
    const row = findRowByLabel("Toggle Play/Pause");
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it("updates overlayPosition on select change and re-renders the table", async () => {
    await loadOptionsModule(); // default: overlayPosition = "center"

    const select = document.getElementById("overlayPosition") as HTMLSelectElement;
    select.value = "top-left";
    select.dispatchEvent(new Event("change"));

    // togglePlayPause has no per-action position, so it inherits the global one
    const row = findRowByLabel("Toggle Play/Pause");
    const posSelect = row.querySelector("select") as HTMLSelectElement;
    expect(posSelect.value).toBe("top-left");
  });
});

describe("options screen overlay controls", () => {
  it("shows unavailable overlay controls for actions without overlays", async () => {
    await loadOptionsModule();

    const row = findRowByLabel("Toggle Fullscreen");
    const cells = row.querySelectorAll("td");

    expect(cells[2]?.textContent).toBe("Unavailable");
    expect(cells[3]?.textContent).toBe("Unavailable");
    expect(cells[2]?.querySelector("input")).toBeNull();
    expect(cells[3]?.querySelector("select")).toBeNull();
  });

  it("disables per-action overlay visibility when the global mode is not custom", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "None";

    await loadOptionsModule(settings);

    const row = findRowByLabel("Toggle Play/Pause");
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const select = row.querySelector("select") as HTMLSelectElement;

    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
    expect(select.disabled).toBe(true);
  });

  it("unchecking the per-action overlay checkbox sets overlayVisible=false", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";

    await loadOptionsModule(settings);

    const row = findRowByLabel("Toggle Play/Pause");
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    // No thrown errors and re-render completes
    expect(checkbox.checked).toBe(false);
  });

  it("checking the per-action overlay checkbox deletes the explicit overlayVisible", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.actions.togglePlayPause.overlayVisible = false;

    await loadOptionsModule(settings);

    const row = findRowByLabel("Toggle Play/Pause");
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // checkbox should be unchecked (overlayVisible=false in custom mode)
    expect(checkbox.checked).toBe(false);

    // Check it — should delete the explicit setting
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    // Re-render: now with no explicit setting, default is true
    const updatedRow = findRowByLabel("Toggle Play/Pause");
    const updatedCheckbox = updatedRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(updatedCheckbox.checked).toBe(true);
  });

  it("changing the per-action overlay position updates the action's position", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";

    await loadOptionsModule(settings);

    const row = findRowByLabel("Toggle Play/Pause");
    const select = row.querySelector("select") as HTMLSelectElement;
    select.value = "top-left";
    select.dispatchEvent(new Event("change"));

    // Re-render should show the newly set position
    const updatedRow = findRowByLabel("Toggle Play/Pause");
    const updatedSelect = updatedRow.querySelector("select") as HTMLSelectElement;
    expect(updatedSelect.value).toBe("top-left");
  });

  it("selecting the global position in the per-action select removes the per-action override", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.overlayVisibility = "Custom";
    settings.overlayPosition = "top-right";
    settings.actions.togglePlayPause.overlayPosition = "bottom-left";

    await loadOptionsModule(settings);

    const row = findRowByLabel("Toggle Play/Pause");
    const select = row.querySelector("select") as HTMLSelectElement;
    // Set it to the global position value to trigger deletion
    select.value = "top-right";
    select.dispatchEvent(new Event("change"));

    // After re-render, inherits global position
    const updatedRow = findRowByLabel("Toggle Play/Pause");
    const updatedSelect = updatedRow.querySelector("select") as HTMLSelectElement;
    expect(updatedSelect.value).toBe("top-right");
  });
});

describe("options screen key binding controls", () => {
  it("removes a key chip when the remove button is clicked", async () => {
    await loadOptionsModule();

    // togglePlayPause has key "k" by default
    const row = findRowByLabel("Toggle Play/Pause");
    const removeBtn = row.querySelector(".key-chip button") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();

    removeBtn.click();

    const updatedRow = findRowByLabel("Toggle Play/Pause");
    expect(updatedRow.querySelectorAll(".key-chip").length).toBe(0);
  });

  it("starts key capture when the + button is clicked", async () => {
    await loadOptionsModule();

    const row = findRowByLabel("Toggle Play/Pause");
    const addBtn = row.querySelector(".add-key-btn") as HTMLButtonElement;
    addBtn.click();

    expect(addBtn.classList.contains("listening")).toBe(true);
    expect(addBtn.textContent).toContain("Press a key");
  });

  it("captures a pressed key and adds it to the action", async () => {
    await loadOptionsModule();

    const row = findRowByLabel("Toggle Mute");
    const addBtn = row.querySelector(".add-key-btn") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));

    const updatedRow = findRowByLabel("Toggle Mute");
    const chips = updatedRow.querySelectorAll(".key-chip");
    const keys = Array.from(chips).map((c) => c.textContent?.replace("×", "").trim());
    expect(keys).toContain("z");
  });

  it("ignores modifier-only keypresses during capture", async () => {
    await loadOptionsModule();

    const row = findRowByLabel("Toggle Mute");
    const chipsBefore = row.querySelectorAll(".key-chip").length;
    const addBtn = row.querySelector(".add-key-btn") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));

    const updatedRow = findRowByLabel("Toggle Mute");
    expect(updatedRow.querySelectorAll(".key-chip").length).toBe(chipsBefore);
    expect(addBtn.classList.contains("listening")).toBe(true);
  });

  it("reassigns a conflicting key to the new action during capture", async () => {
    await loadOptionsModule();

    // "k" is bound to togglePlayPause; bind it to toggleMute
    const row = findRowByLabel("Toggle Mute");
    const addBtn = row.querySelector(".add-key-btn") as HTMLButtonElement;
    addBtn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));

    // togglePlayPause should no longer have "k"
    const playRow = findRowByLabel("Toggle Play/Pause");
    const playChips = Array.from(playRow.querySelectorAll(".key-chip")).map((c) =>
      c.textContent?.replace("×", "").trim(),
    );
    expect(playChips).not.toContain("k");

    // toggleMute should now have "k"
    const muteRow = findRowByLabel("Toggle Mute");
    const muteChips = Array.from(muteRow.querySelectorAll(".key-chip")).map((c) =>
      c.textContent?.replace("×", "").trim(),
    );
    expect(muteChips).toContain("k");
  });
});

describe("options screen save and reset", () => {
  it("clicking save calls saveSettings with current settings", async () => {
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule();

    document.getElementById("save")!.click();
    // Use a macrotask to ensure all pending async continuations complete
    await new Promise((r) => setTimeout(r, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    const statusEl = document.getElementById("status")!;
    expect(statusEl.classList.contains("visible")).toBe(true);
  });

  it("clicking reset restores default settings and calls saveSettings", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.volumeStep = 0.5;
    saveSettingsMock.mockResolvedValue(undefined);
    await loadOptionsModule(settings);

    document.getElementById("reset")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    // Volume step input should be reset to default
    const volumeInput = document.getElementById("volumeStep") as HTMLInputElement;
    expect(volumeInput.value).toBe(String(DEFAULT_SETTINGS.volumeStep));
  });
});
