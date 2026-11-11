import type { Page } from "@playwright/test";
import { createMedia } from "../fixtures.js";
import { expect, test } from "../setup.js";

type ExtensionStorageGlobal = typeof globalThis & {
  chrome: { storage: { sync: { get: (keys: null) => Promise<Record<string, unknown>> } } };
};

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

/** Everything in `storage.sync`, read from an extension page. */
function readStorage(extensionPage: Page): Promise<Record<string, unknown>> {
  return extensionPage.evaluate(() =>
    (globalThis as ExtensionStorageGlobal).chrome.storage.sync.get(null),
  );
}

test("a settings page left open doesn't undo changes made on other surfaces", async ({
  context,
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  const advancedPage = page;
  await advancedPage.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await expect(advancedPage.locator("#showOverlays")).toBeChecked();
  await expect(advancedPage.locator("#volumeStep")).toHaveValue("5");

  // Nothing is stored until a setting changes.
  expect(await readStorage(advancedPage)).toEqual({});

  // Meanwhile the popup rebinds Play/Pause...
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/quick-settings-popup.html`);
  const playPauseKeys = popup
    .locator("#actions-body tr", { hasText: "Play/Pause" })
    .locator(".key-chip-label");
  await expect(playPauseKeys).toHaveText(["k"]);
  await popup.getByRole("button", { name: "Add shortcut key for Play/Pause action" }).click();
  await popup.keyboard.press("x");
  await expect(playPauseKeys).toHaveText(["k", "x"]);

  // ...and the `o` hotkey turns overlays off on a page.
  const mediaPage = await context.newPage();
  await mediaPage.goto(server.getUrl("/"));
  await createMedia(mediaPage, "primary", { currentTime: 25, duration: 100 });
  await mediaPage.locator("#primary").focus();
  await mediaPage.keyboard.press("o");

  await expect
    .poll(async () => (await readStorage(advancedPage))["advanced.showOverlays"])
    .toBe(false);
  await expect
    .poll(async () => (await readStorage(advancedPage))["keys.togglePlayPause"])
    .toEqual(["k", "x"]);

  // The settings page picks the overlay change up without a reload...
  await expect(advancedPage.locator("#showOverlays")).not.toBeChecked();

  // ...so changing the volume step there writes only that setting.
  const volumeStep = advancedPage.locator("#volumeStep");
  await volumeStep.fill("10");
  await volumeStep.blur();
  await expect.poll(async () => (await readStorage(advancedPage))["advanced.volumeStep"]).toBe(0.1);

  expect(await readStorage(advancedPage)).toEqual({
    schemaVersion: 1,
    "advanced.showOverlays": false,
    "advanced.volumeStep": 0.1,
    "keys.togglePlayPause": ["k", "x"],
  });

  // The popup shows what the settings page saved, and still has the new binding.
  await popup.reload();
  await expect(playPauseKeys).toHaveText(["k", "x"]);
  await advancedPage.reload();
  await expect(advancedPage.locator("#showOverlays")).not.toBeChecked();
  await expect(advancedPage.locator("#volumeStep")).toHaveValue("10");
});
