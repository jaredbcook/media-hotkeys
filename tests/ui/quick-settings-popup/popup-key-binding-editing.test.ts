import { beforeEach, describe, expect, it } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import {
  emitStorageChange,
  findRowByLabel,
  flushDomWork,
  getSettingsMock,
  loadQuickSettingsModule,
  resetQuickSettingsTestState,
  saveSettingsMock,
  setCheckbox,
} from "./helpers.js";

beforeEach(() => {
  resetQuickSettingsTestState();
});

describe("quick settings popup: key binding editing", () => {
  it("removes a key chip when the remove button is clicked", async () => {
    await loadQuickSettingsModule();

    const row = findRowByLabel("Play/Pause");
    const removeButton = row.querySelector(".key-chip button") as HTMLButtonElement;
    removeButton.click();
    await flushDomWork();

    const updatedRow = findRowByLabel("Play/Pause");
    expect(updatedRow.querySelectorAll(".key-chip")).toHaveLength(0);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(document.getElementById("announcement-live-region")?.textContent).toContain(
      "k removed from Play/Pause.",
    );
  });

  it("captures a pressed key and adds it to an action", async () => {
    await loadQuickSettingsModule();

    const row = findRowByLabel("Mute/Unmute");
    const addButton = row.querySelector(".add-key-button") as HTMLButtonElement;
    addButton.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    await flushDomWork();

    const updatedRow = findRowByLabel("Mute/Unmute");
    const chips = Array.from(updatedRow.querySelectorAll(".key-chip")).map((chip) =>
      chip.firstChild?.textContent?.trim(),
    );

    expect(chips).toContain("z");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Listening for a shortcut key for Mute/Unmute. Press Escape to cancel.",
    );
    expect(document.getElementById("announcement-live-region")?.textContent).toContain(
      "z assigned to Mute/Unmute.",
    );
  });

  function getChipKeys(label: string): string[] {
    return Array.from(findRowByLabel(label).querySelectorAll(".key-chip")).map(
      (chip) => chip.firstChild?.textContent?.trim() ?? "",
    );
  }

  function startCapture(label: string): HTMLButtonElement {
    const addButton = findRowByLabel(label).querySelector(".add-key-button") as HTMLButtonElement;
    addButton.click();
    return addButton;
  }

  function pressKey(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    document.dispatchEvent(event);
    return event;
  }

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Meta", { metaKey: true }],
    ["Meta with AltGr", { metaKey: true, modifierAltGraph: true }],
  ])("refuses a key pressed with %s and keeps listening", async (_name, modifiers) => {
    await loadQuickSettingsModule();

    const addButton = startCapture("Mute/Unmute");
    const event = pressKey({ key: "z", ...modifiers });
    await flushDomWork();

    expect(event.defaultPrevented).toBe(true);
    expect(getChipKeys("Mute/Unmute")).not.toContain("z");
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Hotkeys don't work while Ctrl, Alt, or Meta is held. Press the key on its own. Press another key, or Escape to cancel.",
    );
    expect(addButton.classList.contains("listening")).toBe(true);

    pressKey({ key: "z" });
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toContain("z");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["Tab", "Tab can't be a hotkey because it moves keyboard focus."],
    ["Enter", "Enter can't be a hotkey because it activates buttons and links."],
    ["Dead", "Accent keys that combine with the next key can't be hotkeys."],
    ["Process", "Keys typed through an input method can't be hotkeys."],
    ["Unidentified", "The browser can't identify that key, so it can't be a hotkey."],
    ["CapsLock", "Caps Lock can't be a hotkey."],
  ])("refuses %s and keeps listening", async (key, reason) => {
    await loadQuickSettingsModule();

    const addButton = startCapture("Mute/Unmute");
    pressKey({ key });
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).not.toContain(key);
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById("announcements")?.textContent).toContain(reason);
    expect(addButton.classList.contains("listening")).toBe(true);

    pressKey({ key: "z" });
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toContain("z");
  });

  it("refuses a key pressed while an input method is composing", async () => {
    await loadQuickSettingsModule();

    const addButton = startCapture("Mute/Unmute");
    pressKey({ key: "z", isComposing: true });
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).not.toContain("z");
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById("announcements")?.textContent).toContain(
      "Keys typed through an input method can't be hotkeys.",
    );
    expect(addButton.classList.contains("listening")).toBe(true);
  });

  it("waits for the main key when only a modifier is pressed", async () => {
    await loadQuickSettingsModule();

    const addButton = startCapture("Mute/Unmute");
    pressKey({ key: "AltGraph", modifierAltGraph: true });
    pressKey({ key: "Shift", shiftKey: true });
    await flushDomWork();

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(addButton.classList.contains("listening")).toBe(true);
  });

  it.each([
    [
      "a character typed with AltGr",
      { key: "@", ctrlKey: true, altKey: true, modifierAltGraph: true },
    ],
    ["a letter on a non-Latin layout", { key: "\u043b" }],
    ["a named key", { key: "PageDown" }],
  ])("accepts %s", async (_name, init) => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey(init);
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toContain(init.key);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("keeps the default bindings untouched after a refused key", async () => {
    await loadQuickSettingsModule();

    startCapture("Play/Pause");
    pressKey({ key: "k", ctrlKey: true });
    await flushDomWork();

    expect(getChipKeys("Play/Pause")).toEqual(
      defaults.quickSettings.actionKeyBindings.togglePlayPause.keys,
    );
  });
});

describe("quick settings popup: settings changed elsewhere while it is open", () => {
  function getChipKeys(label: string): string[] {
    return Array.from(findRowByLabel(label).querySelectorAll(".key-chip")).map(
      (chip) => chip.firstChild?.textContent?.trim() ?? "",
    );
  }

  it("shows a key binding changed elsewhere and doesn't write it back on the next edit", async () => {
    await loadQuickSettingsModule();

    const latest = structuredClone(defaults) as typeof defaults;
    latest.quickSettings.actionKeyBindings.toggleMute.keys = ["u"];
    latest.advancedSettings.showOverlays = false;
    getSettingsMock.mockResolvedValue(latest as never);
    await emitStorageChange();
    expect(getChipKeys("Mute/Unmute")).toEqual(["u"]);

    const removeButton = findRowByLabel("Play/Pause").querySelector(
      ".key-chip button",
    ) as HTMLButtonElement;
    removeButton.click();
    await flushDomWork();

    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      quickSettings: { actionKeyBindings: { togglePlayPause: { keys: [] } } },
    });
  });

  it("doesn't write back a binding changed elsewhere before the popup learned of it", async () => {
    await loadQuickSettingsModule();

    setCheckbox("disable-everywhere", true);
    await flushDomWork();

    expect(saveSettingsMock.mock.calls[0]?.[0]).toEqual({
      quickSettings: { hotkeysEnabled: false },
    });
  });

  it("stops a pending key capture when the table is rebuilt for a change made elsewhere", async () => {
    await loadQuickSettingsModule();
    (findRowByLabel("Mute/Unmute").querySelector(".add-key-button") as HTMLButtonElement).click();

    const latest = structuredClone(defaults) as typeof defaults;
    latest.quickSettings.actionKeyBindings.restart.keys = [];
    getSettingsMock.mockResolvedValue(latest as never);
    await emitStorageChange();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    await flushDomWork();

    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(getChipKeys("Restart")).toEqual([]);
  });

  it("keeps a pending key capture when the change doesn't touch the key bindings", async () => {
    await loadQuickSettingsModule();
    (findRowByLabel("Mute/Unmute").querySelector(".add-key-button") as HTMLButtonElement).click();

    const latest = structuredClone(defaults) as typeof defaults;
    latest.advancedSettings.showOverlays = false;
    getSettingsMock.mockResolvedValue(latest as never);
    await emitStorageChange();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toContain("z");
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("shows the newest settings when an older read finishes last", async () => {
    await loadQuickSettingsModule();
    getSettingsMock.mockReset();

    const older = structuredClone(defaults) as typeof defaults;
    older.quickSettings.actionKeyBindings.toggleMute.keys = ["u"];
    const newer = structuredClone(defaults) as typeof defaults;
    newer.quickSettings.actionKeyBindings.toggleMute.keys = ["v"];
    let finishOlderRead!: () => void;
    getSettingsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOlderRead = () => resolve(older as never);
        }),
    );
    getSettingsMock.mockResolvedValueOnce(newer as never);

    await emitStorageChange();
    await emitStorageChange();
    finishOlderRead();
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toEqual(["v"]);
  });

  it("shows what is stored when a save fails, so the edit can be retried", async () => {
    await loadQuickSettingsModule();
    saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));

    const removeButton = findRowByLabel("Play/Pause").querySelector(
      ".key-chip button",
    ) as HTMLButtonElement;
    removeButton.click();
    await flushDomWork();

    expect(document.getElementById("announcements")?.textContent).toContain(
      "Failed to save settings.",
    );
    expect(getChipKeys("Play/Pause")).toEqual(["k"]);

    (findRowByLabel("Play/Pause").querySelector(".key-chip button") as HTMLButtonElement).click();
    await flushDomWork();

    expect(saveSettingsMock).toHaveBeenCalledTimes(2);
    expect(saveSettingsMock.mock.calls[1]?.[0]).toEqual({
      quickSettings: { actionKeyBindings: { togglePlayPause: { keys: [] } } },
    });
  });

  it("doesn't let the read after a failed save overwrite a newer edit", async () => {
    await loadQuickSettingsModule();
    getSettingsMock.mockReset();
    let finishRecoveryRead!: () => void;
    getSettingsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecoveryRead = () => resolve(structuredClone(defaults) as never);
        }),
    );
    saveSettingsMock.mockRejectedValueOnce(new Error("quota exceeded"));

    (findRowByLabel("Play/Pause").querySelector(".key-chip button") as HTMLButtonElement).click();
    await flushDomWork();

    // The user edits another action while the recovery read is still out.
    (findRowByLabel("Mute/Unmute").querySelector(".key-chip button") as HTMLButtonElement).click();
    await flushDomWork();
    finishRecoveryRead();
    await flushDomWork();

    expect(getChipKeys("Mute/Unmute")).toEqual([]);
  });

  it("ignores changes in other storage areas", async () => {
    await loadQuickSettingsModule();
    getSettingsMock.mockClear();

    await emitStorageChange("local");

    expect(getSettingsMock).not.toHaveBeenCalled();
  });
});
