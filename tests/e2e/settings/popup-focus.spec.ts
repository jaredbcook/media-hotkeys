import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../setup.js";

async function getExtensionId(page: Page): Promise<string> {
  await page.goto("chrome://extensions/");
  await page.waitForFunction(() => {
    return Boolean(
      document
        .querySelector("extensions-manager")
        ?.shadowRoot?.querySelector("extensions-item-list")
        ?.shadowRoot?.querySelector("extensions-item")?.id,
    );
  });

  return page.evaluate(() => {
    const extensionId = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-item-list")
      ?.shadowRoot?.querySelector("extensions-item")?.id;

    if (!extensionId) {
      throw new Error("Media Hotkeys extension ID was not found");
    }

    return extensionId;
  });
}

async function openPopup(page: Page): Promise<void> {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/quick-settings-popup.html`);
  await expect(page.locator("#actions-body tr")).not.toHaveCount(0);
}

function keysOf(page: Page, action: string): Locator {
  return page.locator("#actions-body tr", { hasText: action }).locator(".key-chip-label");
}

function addButton(page: Page, action: string): Locator {
  return page.getByRole("button", { name: `Add shortcut key for ${action} action` });
}

function removeButton(page: Page, key: string, action: string): Locator {
  return page.getByRole("button", { name: `Remove ${key} key from ${action} action` });
}

test("focus stays on the add button after a key is bound with the keyboard", async ({ page }) => {
  await openPopup(page);

  const add = addButton(page, "Mute/Unmute");
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Press a key to assign it to Mute/Unmute" }),
  ).toBeFocused();

  await page.keyboard.press("z");
  await expect(keysOf(page, "Mute/Unmute")).toHaveText(["m", "z"]);
  await expect(add).toBeFocused();

  // The same button is still the place to continue: a second key can be bound without tabbing back.
  await page.keyboard.press("Enter");
  await page.keyboard.press("x");
  await expect(keysOf(page, "Mute/Unmute")).toHaveText(["m", "z", "x"]);
  await expect(add).toBeFocused();
});

test("focus stays on the action being edited when its key is taken from another action", async ({
  page,
}) => {
  await openPopup(page);

  const add = addButton(page, "Mute/Unmute");
  await add.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("k");

  await expect(keysOf(page, "Play/Pause")).toHaveText([]);
  await expect(keysOf(page, "Mute/Unmute")).toHaveText(["m", "k"]);
  await expect(add).toBeFocused();
});

test("focus moves along the keys of an action as they are removed with the keyboard", async ({
  page,
}) => {
  await openPopup(page);
  await expect(keysOf(page, "Volume Up")).toHaveText(["▲Up Arrow", "+", "="]);

  await removeButton(page, "Up Arrow", "Volume Up").focus();
  await page.keyboard.press("Enter");
  await expect(keysOf(page, "Volume Up")).toHaveText(["+", "="]);
  await expect(removeButton(page, "+", "Volume Up")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(keysOf(page, "Volume Up")).toHaveText(["="]);
  await expect(removeButton(page, "=", "Volume Up")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(keysOf(page, "Volume Up")).toHaveText([]);
  await expect(addButton(page, "Volume Up")).toBeFocused();

  // The change is stored, not only shown.
  await page.reload();
  await expect(keysOf(page, "Volume Up")).toHaveText([]);
});

test("focus survives a change made in another popup", async ({ context, page }) => {
  await openPopup(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(keysOf(other, "Restart")).toHaveText(["r"]);

  const add = addButton(page, "Mute/Unmute");
  await add.focus();
  await removeButton(other, "r", "Restart").click();

  // The first popup rebuilds its table for the change, and focus is still on the same button.
  await expect(keysOf(page, "Restart")).toHaveText([]);
  await expect(add).toBeFocused();
});

test("removing a key ends a pending key capture, so Enter on the focused control still works", async ({
  page,
}) => {
  await openPopup(page);

  await addButton(page, "Mute/Unmute").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".add-key-button.listening")).toHaveCount(1);

  await removeButton(page, "Up Arrow", "Volume Up").click();
  await expect(page.locator(".add-key-button.listening")).toHaveCount(0);
  await expect(removeButton(page, "+", "Volume Up")).toBeFocused();

  // Enter operates the focused remove button instead of being swallowed by a stale capture.
  await page.keyboard.press("Enter");
  await expect(keysOf(page, "Volume Up")).toHaveText(["="]);
  await expect(keysOf(page, "Mute/Unmute")).toHaveText(["m"]);
});
