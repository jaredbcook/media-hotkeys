export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

const CONFIRM_VALUE = "confirm";

let openDialog: HTMLDialogElement | undefined;
let dialogCount = 0;

/**
 * Asks the user to confirm a destructive action in a native modal dialog and resolves to whether they
 * confirmed. Nothing happens until they answer, so closing the popup mid-question is the same as Cancel.
 *
 * The browser's modal `<dialog>` makes the rest of the page inert, keeps focus inside, closes on Escape,
 * and returns focus to the button that opened it. Focus starts on Cancel so Enter or Space can't confirm
 * by accident.
 */
export function confirmWithDialog(options: ConfirmDialogOptions): Promise<boolean> {
  // Checks `open` rather than waiting for the `close` event, which fires a task after the dialog closes:
  // a button pressed again in that gap must still get its question.
  if (openDialog?.open) {
    return Promise.resolve(false);
  }

  dialogCount += 1;
  const titleId = `confirm-dialog-title-${dialogCount}`;
  const messageId = `confirm-dialog-message-${dialogCount}`;

  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog";
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", messageId);

  const title = document.createElement("h2");
  title.id = titleId;
  title.textContent = options.title;

  const message = document.createElement("p");
  message.id = messageId;
  message.textContent = options.message;

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "confirm-dialog-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.autofocus = true;
  cancelButton.addEventListener("click", () => {
    dialog.close();
  });

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "confirm-dialog-confirm primary";
  confirmButton.textContent = options.confirmLabel;
  confirmButton.addEventListener("click", () => {
    dialog.close(CONFIRM_VALUE);
  });

  const buttons = document.createElement("div");
  buttons.className = "button-group";
  buttons.append(cancelButton, confirmButton);

  dialog.append(title, message, buttons);

  return new Promise((resolve) => {
    // Escape closes the dialog without a return value, so only the confirm button confirms.
    dialog.addEventListener("close", () => {
      if (openDialog === dialog) {
        openDialog = undefined;
      }
      const confirmed = dialog.returnValue === CONFIRM_VALUE;
      dialog.remove();
      resolve(confirmed);
    });

    document.body.appendChild(dialog);
    openDialog = dialog;
    dialog.showModal();
  });
}
