import type { Page } from "@playwright/test";
import { createMedia, readMediaState } from "../fixtures.js";
import { expect, test } from "../setup.js";

type ExtensionStorageGlobal = typeof globalThis & {
  chrome: { storage: { sync: { set: (items: Record<string, unknown>) => Promise<void> } } };
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

// Bindings as an earlier version, or someone editing storage by hand, could have left them.
const SAVED_BINDINGS = {
  schemaVersion: 1,
  "keys.togglePlayPause": ["Tab", "Enter", "j"],
  "keys.toggleMute": ["u", "CapsLock"],
};

test("keys the popup refuses are dropped from saved bindings, so they stay with the page", async ({
  context,
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/quick-settings-popup.html`);
  await page.evaluate(
    (items) => (globalThis as ExtensionStorageGlobal).chrome.storage.sync.set(items),
    SAVED_BINDINGS,
  );
  await page.reload();

  // The popup lists only the keys that still bind.
  const chipLabels = (action: string) =>
    page.locator("#actions-body tr", { hasText: action }).locator(".key-chip-label");
  await expect(chipLabels("Play/Pause")).toHaveText(["j"]);
  await expect(chipLabels("Mute/Unmute")).toHaveText(["u"]);

  const mediaPage = await context.newPage();
  await mediaPage.goto(server.getUrl("/"));
  await createMedia(mediaPage, "primary");
  await mediaPage.evaluate(() => {
    const keys: { key: string; defaultPrevented: boolean }[] = [];
    (window as typeof window & { __pageKeys: typeof keys }).__pageKeys = keys;
    // The content script stops the keys it handles in the capture phase, so a key this listener sees
    // reached the page, and `defaultPrevented` shows whether the extension had taken it.
    window.addEventListener("keydown", (event) =>
      keys.push({ key: event.key, defaultPrevented: event.defaultPrevented }),
    );
  });
  await mediaPage.locator("#primary").focus();

  await mediaPage.keyboard.press("Tab");
  await mediaPage.keyboard.press("CapsLock");

  expect(
    await mediaPage.evaluate(
      () => (window as typeof window & { __pageKeys: unknown[] }).__pageKeys,
    ),
  ).toEqual([
    { key: "Tab", defaultPrevented: false },
    { key: "CapsLock", defaultPrevented: false },
  ]);
  expect((await readMediaState(mediaPage, "primary")).paused).toBe(true);
  expect((await readMediaState(mediaPage, "primary")).muted).toBe(false);

  // A usable key saved next to the dropped ones still works.
  await mediaPage.locator("#primary").focus();
  await mediaPage.keyboard.press("u");
  await expect.poll(async () => (await readMediaState(mediaPage, "primary")).muted).toBe(true);
});
