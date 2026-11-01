import { beforeEach, describe, expect, it } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import {
  findRowByLabel,
  flushDomWork,
  loadQuickSettingsModule,
  resetQuickSettingsTestState,
  saveSettingsMock,
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
