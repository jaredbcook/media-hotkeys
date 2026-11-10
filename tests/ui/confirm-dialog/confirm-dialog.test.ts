import { beforeEach, describe, expect, it } from "vitest";
import { confirmWithDialog } from "../../../src/confirm-dialog.js";
import { answerConfirmDialog, getConfirmDialog, installDialogStub } from "../dialog-stub.js";

const OPTIONS = {
  title: "Restore defaults?",
  message: "This can't be undone.",
  confirmLabel: "Restore Defaults",
};

beforeEach(() => {
  installDialogStub();
  getConfirmDialog()?.close();
  document.body.innerHTML = "";
});

describe("confirmation dialog", () => {
  it("opens a labelled and described modal dialog with focus set to start on Cancel", () => {
    void confirmWithDialog(OPTIONS);

    const dialog = getConfirmDialog();
    expect(dialog?.hasAttribute("open")).toBe(true);

    const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
    const message = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "");
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent).toBe("Restore defaults?");
    expect(message?.textContent).toBe("This can't be undone.");

    const buttons = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Restore Defaults"]);
    expect(buttons.map((button) => button.autofocus)).toEqual([true, false]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
  });

  it("resolves true and removes the dialog when confirmed", async () => {
    const result = confirmWithDialog(OPTIONS);
    await answerConfirmDialog("confirm");

    await expect(result).resolves.toBe(true);
    expect(getConfirmDialog()).toBeNull();
  });

  it("resolves false and removes the dialog when canceled", async () => {
    const result = confirmWithDialog(OPTIONS);
    await answerConfirmDialog("cancel");

    await expect(result).resolves.toBe(false);
    expect(getConfirmDialog()).toBeNull();
  });

  it("resolves false when the dialog closes without an answer, as Escape does", async () => {
    const result = confirmWithDialog(OPTIONS);
    getConfirmDialog()?.close();

    await expect(result).resolves.toBe(false);
    expect(getConfirmDialog()).toBeNull();
  });

  it("refuses a second dialog while one is open and works again afterwards", async () => {
    const first = confirmWithDialog(OPTIONS);

    await expect(confirmWithDialog(OPTIONS)).resolves.toBe(false);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);

    await answerConfirmDialog("cancel");
    await expect(first).resolves.toBe(false);

    const second = confirmWithDialog(OPTIONS);
    await answerConfirmDialog("confirm");
    await expect(second).resolves.toBe(true);
  });

  it("opens a new dialog right after one closes, before its close event has fired", async () => {
    const first = confirmWithDialog(OPTIONS);
    getConfirmDialog()?.querySelector<HTMLButtonElement>(".confirm-dialog-cancel")?.click();

    const second = confirmWithDialog(OPTIONS);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

    await expect(first).resolves.toBe(false);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);

    document.querySelector<HTMLButtonElement>("dialog[open] .confirm-dialog-confirm")?.click();
    await expect(second).resolves.toBe(true);
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
  });
});
