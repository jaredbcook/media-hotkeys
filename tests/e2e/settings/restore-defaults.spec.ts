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

/**
 * Reloads until the page shows what storage should hold. A save is still in flight when the form already
 * shows the new values, so a single reload can read storage too early. Only use it to wait for a change
 * to land; to prove that nothing changed, reload once from a state already known to be stored.
 */
async function expectAfterReload(page: Page, assertion: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.reload();
    await assertion();
  }).toPass({ timeout: 15_000 });
}

function playPauseKeys(page: Page): Locator {
  return page.locator("#actions-body tr", { hasText: "Play/Pause" }).locator(".key-chip-label");
}

async function openPopupWithCustomBinding(page: Page): Promise<void> {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/quick-settings-popup.html`);
  await expect(playPauseKeys(page)).toHaveText(["k"]);

  await page.getByRole("button", { name: "Add shortcut key for Play/Pause action" }).click();
  await page.keyboard.press("x");
  await expect(playPauseKeys(page)).toHaveText(["k", "x"]);

  // Start from a binding that is known to be in storage, so later reloads prove what was kept or reset.
  await expectAfterReload(page, async () => {
    await expect(playPauseKeys(page)).toHaveText(["k", "x"], { timeout: 2000 });
  });
}

test("popup Restore Defaults is confirmed or canceled with the keyboard alone", async ({
  page,
}) => {
  await openPopupWithCustomBinding(page);

  const reset = page.locator("#reset");
  const dialog = page.getByRole("dialog", { name: "Restore default key bindings?" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const confirm = dialog.getByRole("button", { name: "Restore Defaults" });

  // Focus starts on Cancel, so a second Enter doesn't restore anything.
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/can't be undone/);
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(playPauseKeys(page)).toHaveText(["k", "x"]);

  // Escape cancels and returns focus to the button.
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(playPauseKeys(page)).toHaveText(["k", "x"]);

  // The custom binding survived both cancels in storage, not only on screen.
  await page.reload();
  await expect(playPauseKeys(page)).toHaveText(["k", "x"]);

  // Tab stays inside the dialog, and confirming restores the defaults.
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(playPauseKeys(page)).toHaveText(["k"]);
  await expect(page.locator("#announcements .announcement").last()).toContainText(
    "Quick settings reset to default values.",
  );

  await expectAfterReload(page, async () => {
    await expect(playPauseKeys(page)).toHaveText(["k"], { timeout: 2000 });
  });
});

test("popup Restore Defaults ends a pending key capture before asking", async ({ page }) => {
  await openPopupWithCustomBinding(page);

  await page.getByRole("button", { name: "Add shortcut key for Mute/Unmute action" }).click();
  await expect(page.locator(".add-key-button.listening")).toHaveCount(1);

  await page.locator("#reset").click();
  const dialog = page.getByRole("dialog", { name: "Restore default key bindings?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".add-key-button.listening")).toHaveCount(0);

  // Escape reaches the dialog instead of being swallowed by the key capture.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(playPauseKeys(page)).toHaveText(["k", "x"]);
});

test("popup Restore Defaults is out of reach while hotkeys are disabled on all pages", async ({
  page,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/quick-settings-popup.html`);
  await expect(page.locator("#reset")).toBeVisible();

  // The confirmation only mentions key bindings, so the button must never be usable while a restore
  // would also turn the disabled extension back on.
  await page.getByLabel("Disable on all pages").check();
  await expect(page.locator("#reset")).toBeHidden();
  await expect(page.getByRole("button", { name: "Restore Defaults" })).toHaveCount(0);
});

test("advanced settings Restore Defaults needs confirming and blocks the page meanwhile", async ({
  page,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);

  const volumeStep = page.locator("#volumeStep");
  const debugLogging = page.locator("#debugLogging");
  await expect(volumeStep).toHaveValue("5");
  await volumeStep.fill("10");
  await volumeStep.blur();
  await expect(page.locator("#announcements .announcement").last()).toContainText(
    "Settings saved.",
  );
  await debugLogging.check();

  // Start from custom values that are known to be in storage, so later reloads prove what was kept or reset.
  await expectAfterReload(page, async () => {
    await expect(volumeStep).toHaveValue("10", { timeout: 2000 });
    await expect(debugLogging).toBeChecked({ timeout: 2000 });
  });

  const reset = page.locator("#reset");
  const dialog = page.getByRole("dialog", { name: "Restore default advanced settings?" });

  await reset.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // The page behind the modal dialog can't be changed while the question is open.
  await expect(debugLogging.click({ timeout: 500 })).rejects.toThrow();
  await expect(debugLogging).toBeChecked();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(volumeStep).toHaveValue("10");

  await page.reload();
  await expect(volumeStep).toHaveValue("10");
  await expect(debugLogging).toBeChecked();

  await reset.click();
  await dialog.getByRole("button", { name: "Restore Defaults" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(volumeStep).toHaveValue("5");
  await expect(debugLogging).not.toBeChecked();

  await expectAfterReload(page, async () => {
    await expect(volumeStep).toHaveValue("5", { timeout: 2000 });
    await expect(debugLogging).not.toBeChecked({ timeout: 2000 });
  });
});
