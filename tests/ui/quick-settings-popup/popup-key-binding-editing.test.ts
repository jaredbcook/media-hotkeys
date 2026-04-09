import { beforeEach, describe, expect, it } from "vitest";
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
});
