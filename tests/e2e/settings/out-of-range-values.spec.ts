import type { Page } from "@playwright/test";
import {
  createMedia,
  markPlaying,
  readMediaState,
  trackSeeks,
  waitForMediaState,
} from "../fixtures.js";
import { openOverlayReader } from "../overlay.js";
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

// Numbers as an older version, or someone editing storage by hand, could have left them.
const SAVED_NUMBERS = {
  schemaVersion: 1,
  "advanced.seekStepSmall": 0,
  "advanced.volumeStep": -3,
};

test("saved numbers outside their range are clamped, so the keys still act", async ({
  context,
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await page.evaluate(
    (items) => (globalThis as ExtensionStorageGlobal).chrome.storage.sync.set(items),
    SAVED_NUMBERS,
  );

  // The options page shows the limits the content script will use.
  await page.reload();
  await expect(page.locator("#seekStepSmall")).toHaveValue("1");
  await expect(page.locator("#volumeStep")).toHaveValue("1");

  const mediaPage = await context.newPage();
  await mediaPage.goto(server.getUrl("/"));
  await createMedia(mediaPage, "primary", { muted: false, volume: 0.5, playbackRate: 1 });
  await mediaPage.locator("#primary").focus();
  const overlay = await openOverlayReader(mediaPage);

  // With the stored step of 0 the volume would not move.
  await mediaPage.keyboard.press("ArrowDown");
  await waitForMediaState(mediaPage, "primary", (state) => Math.abs(state.volume - 0.49) < 0.0001);
  await expect.poll(async () => (await overlay.read())?.text).toBe("49%");

  // Nor would the seek.
  await markPlaying(mediaPage, "primary");
  await waitForMediaState(mediaPage, "primary", (state) => !state.paused);
  const seekBaseline = (await readMediaState(mediaPage, "primary")).currentTime;
  await trackSeeks(mediaPage, "primary");
  await mediaPage.keyboard.press("ArrowRight");
  await waitForMediaState(mediaPage, "primary", (state) =>
    state.seekLandings.some((time) => time >= seekBaseline + 1),
  );
  await expect.poll(async () => (await overlay.read())?.text).toBe("+1s");
});
