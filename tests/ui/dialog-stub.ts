/**
 * jsdom has no `showModal()` or `close()` on `<dialog>`. These stubs cover what the settings UIs rely on:
 * the `open` attribute, `returnValue`, and the `close` event. Focus handling, the inert page, and Escape
 * are the browser's job and are covered by the E2E tests.
 */
export function installDialogStub(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ): void {
    if (!this.hasAttribute("open")) {
      return;
    }

    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    this.removeAttribute("open");
    // Browsers fire `close` in a later task, not synchronously.
    setTimeout(() => {
      this.dispatchEvent(new Event("close"));
    }, 0);
  };
}

export function getConfirmDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("dialog.confirm-dialog");
}

/** Answers the open confirmation dialog the way a click on Cancel or the confirm button would. */
export async function answerConfirmDialog(answer: "confirm" | "cancel"): Promise<void> {
  const button = getConfirmDialog()?.querySelector<HTMLButtonElement>(`.confirm-dialog-${answer}`);
  if (!button) {
    throw new Error("No confirmation dialog is open");
  }

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
