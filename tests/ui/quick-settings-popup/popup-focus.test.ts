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
} from "./helpers.js";

beforeEach(() => {
  resetQuickSettingsTestState();
});

function addButton(label: string): HTMLButtonElement {
  return findRowByLabel(label).querySelector(".add-key-button") as HTMLButtonElement;
}

function removeButtons(label: string): HTMLButtonElement[] {
  return Array.from(findRowByLabel(label).querySelectorAll(".delete-button"));
}

function pressKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** Presses the add button as a keyboard user does: focus it, then activate it. */
function startCapture(label: string): void {
  const button = addButton(label);
  button.focus();
  button.click();
}

/** Describes where focus is in terms a reader of the table would use. */
function focusedControl(): string | undefined {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLButtonElement) || !focused.closest("#actions-body")) {
    return undefined;
  }
  return focused.getAttribute("aria-label") ?? undefined;
}

describe("quick settings popup: keyboard focus after editing keys", () => {
  it("returns focus to the add button of the same action after a key is bound", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey("z");
    await flushDomWork();

    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
    expect(focusedControl()).toBe("Add shortcut key for Mute/Unmute action");
  });

  it("keeps focus on the action being edited when the key is taken from another action", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey("k");
    await flushDomWork();

    expect(findRowByLabel("Play/Pause").querySelectorAll(".key-chip")).toHaveLength(0);
    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
  });

  it("keeps focus on the add button when capture is canceled", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey("Escape");

    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
    expect(addButton("Mute/Unmute").classList.contains("listening")).toBe(false);
  });

  it("keeps focus on the add button while a refused key keeps capture open", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey("Tab");

    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
    expect(addButton("Mute/Unmute").classList.contains("listening")).toBe(true);
  });

  it("moves focus to the next key's remove button when a key is removed", async () => {
    await loadQuickSettingsModule();

    const [first] = removeButtons("Volume Up");
    first?.focus();
    first?.click();
    await flushDomWork();

    expect(removeButtons("Volume Up")).toHaveLength(2);
    expect(document.activeElement).toBe(removeButtons("Volume Up")[0]);
    expect(focusedControl()).toBe("Remove + key from Volume Up action");
  });

  it("moves focus to the add button when the last key of an action is removed", async () => {
    await loadQuickSettingsModule();

    const buttons = removeButtons("Volume Up");
    const last = buttons[buttons.length - 1];
    last?.focus();
    last?.click();
    await flushDomWork();

    expect(removeButtons("Volume Up")).toHaveLength(2);
    expect(document.activeElement).toBe(addButton("Volume Up"));
  });

  it("moves focus to the add button when an action's only key is removed", async () => {
    await loadQuickSettingsModule();

    const [only] = removeButtons("Play/Pause");
    only?.focus();
    only?.click();
    await flushDomWork();

    expect(removeButtons("Play/Pause")).toHaveLength(0);
    expect(document.activeElement).toBe(addButton("Play/Pause"));
    expect(saveSettingsMock).toHaveBeenCalledOnce();
  });

  it("lets a keyboard user remove every key of an action in turn", async () => {
    await loadQuickSettingsModule();

    removeButtons("Volume Up")[0]?.focus();
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      (document.activeElement as HTMLButtonElement).click();
      await flushDomWork();
      expect(removeButtons("Volume Up")).toHaveLength(remaining - 1);
    }

    expect(document.activeElement).toBe(addButton("Volume Up"));
  });

  it("ends a pending key capture when a remove button is used, so the focused control works", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    const [first] = removeButtons("Volume Up");
    first?.focus();
    first?.click();
    await flushDomWork();

    expect(document.querySelector(".add-key-button.listening")).toBeNull();
    const event = new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    await flushDomWork();

    // Nothing is listening: the key isn't bound and keeps its normal behavior on the focused button.
    expect(event.defaultPrevented).toBe(false);
    expect(saveSettingsMock).toHaveBeenCalledOnce();
    expect(findRowByLabel("Mute/Unmute").textContent).not.toContain("z");
    expect(document.activeElement).toBe(removeButtons("Volume Up")[0]);
  });

  it("announces the change after the focus has moved", async () => {
    await loadQuickSettingsModule();

    startCapture("Mute/Unmute");
    pressKey("z");
    await flushDomWork();

    expect(document.getElementById("announcement-live-region")?.textContent).toContain(
      "z assigned to Mute/Unmute.",
    );
    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
  });
});

describe("quick settings popup: keyboard focus when the table is rebuilt for another reason", () => {
  async function changeElsewhere(change: (latest: typeof defaults) => void): Promise<void> {
    const latest = structuredClone(defaults) as typeof defaults;
    change(latest);
    getSettingsMock.mockResolvedValue(latest as never);
    await emitStorageChange();
  }

  it("keeps focus on a remove button when a change made elsewhere rebuilds the table", async () => {
    await loadQuickSettingsModule();
    removeButtons("Mute/Unmute")[0]?.focus();

    await changeElsewhere((latest) => {
      latest.quickSettings.actionKeyBindings.restart.keys = [];
    });

    expect(findRowByLabel("Restart").querySelectorAll(".key-chip")).toHaveLength(0);
    expect(document.activeElement).toBe(removeButtons("Mute/Unmute")[0]);
  });

  it("falls back to the add button when the focused key was removed elsewhere", async () => {
    await loadQuickSettingsModule();
    removeButtons("Mute/Unmute")[0]?.focus();

    await changeElsewhere((latest) => {
      latest.quickSettings.actionKeyBindings.toggleMute.keys = [];
    });

    expect(removeButtons("Mute/Unmute")).toHaveLength(0);
    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
  });

  it("keeps focus on the add button when capture is stopped by a change made elsewhere", async () => {
    await loadQuickSettingsModule();
    startCapture("Mute/Unmute");

    await changeElsewhere((latest) => {
      latest.quickSettings.actionKeyBindings.restart.keys = [];
    });

    expect(document.activeElement).toBe(addButton("Mute/Unmute"));
    expect(addButton("Mute/Unmute").classList.contains("listening")).toBe(false);
  });

  it("doesn't pull focus into the table when it was somewhere else", async () => {
    await loadQuickSettingsModule();
    const advanced = document.getElementById("advanced-settings") as HTMLButtonElement;
    advanced.focus();

    await changeElsewhere((latest) => {
      latest.quickSettings.actionKeyBindings.restart.keys = [];
    });

    expect(findRowByLabel("Restart").querySelectorAll(".key-chip")).toHaveLength(0);
    expect(document.activeElement).toBe(advanced);
  });
});
