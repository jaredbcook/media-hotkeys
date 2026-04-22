import type { Page } from "@playwright/test";
import { createMedia, waitForMediaState } from "../fixtures.js";
import { expect, test } from "../setup.js";

type StoredExtensionSettings = {
  advancedSettings?: {
    debugLogging?: boolean;
  };
};

type ExtensionStorageGlobal = typeof globalThis & {
  chrome: {
    storage: {
      sync: {
        get: (keys: null) => Promise<StoredExtensionSettings>;
      };
    };
  };
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

test("persists debug logging and applies it to content scripts", async ({ page, server }) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await page.waitForSelector("#debugLogging");

  await expect(page.locator("#debugLogging")).not.toBeChecked();
  await page.locator("#debugLogging").check();
  await expect(page.locator("#status")).toHaveClass(/visible/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const extensionGlobal = globalThis as ExtensionStorageGlobal;
        return extensionGlobal.chrome.storage.sync
          .get(null)
          .then((settings) => settings.advancedSettings?.debugLogging);
      }),
    )
    .toBe(true);

  await page.reload();
  await page.waitForSelector("#debugLogging");
  await expect(page.locator("#debugLogging")).toBeChecked();

  const debugMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "info" && message.text().includes("[Media Hotkeys][debug]")) {
      debugMessages.push(message.text());
    }
  });

  await page.goto(server.getUrl("/"));
  await createMedia(page, "primary");
  await page.locator("#primary").focus();
  await page.keyboard.press("m");
  await waitForMediaState(page, "primary", (state) => state.muted);

  await expect
    .poll(() => {
      return debugMessages.some((message) => message.includes("Handled media action"));
    })
    .toBe(true);
});
