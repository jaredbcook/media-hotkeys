import type { Page } from "@playwright/test";
import {
  createMedia,
  readFrameMediaState,
  readMediaState,
  waitForMediaState,
} from "../fixtures.js";
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

async function addNativeKeyCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener("keydown", (event) => {
      if (event.key !== "k") {
        return;
      }

      const testWindow = window as typeof window & { nativeKeyCount?: number };
      testWindow.nativeKeyCount = (testWindow.nativeKeyCount ?? 0) + 1;
    });
  });
}

async function readNativeKeyCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return (window as typeof window & { nativeKeyCount?: number }).nativeKeyCount ?? 0;
  });
}

test("site policies let page shortcuts win only on matching paths", async ({ page, server }) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await page.locator("#add-site-policy").click();
  await page.locator(".site-policy-pattern").fill("127.0.0.1/shorts");
  await expect(page.locator("#announcements .announcement").last()).toContainText(
    "Settings saved.",
  );

  await page.goto(server.getUrl("/shorts"));
  await addNativeKeyCounter(page);
  await createMedia(page, "shorts-media");
  await page.locator("#shorts-media").focus();
  await page.keyboard.press("k");

  await expect.poll(() => readNativeKeyCount(page)).toBe(1);
  expect((await readMediaState(page, "shorts-media")).paused).toBe(true);

  await page.goto(server.getUrl("/watch"));
  await addNativeKeyCounter(page);
  await createMedia(page, "watch-media");
  await page.locator("#watch-media").focus();
  await page.keyboard.press("k");

  await waitForMediaState(page, "watch-media", (state) => !state.paused);
  await expect.poll(() => readNativeKeyCount(page)).toBe(0);
});

test("site policies follow in-page navigation", async ({ page, server }) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await page.locator("#add-site-policy").click();
  await page.locator(".site-policy-pattern").fill("127.0.0.1/shorts");
  await expect(page.locator("#announcements .announcement").last()).toContainText(
    "Settings saved.",
  );

  await page.goto(server.getUrl("/watch"));
  await addNativeKeyCounter(page);
  await createMedia(page, "spa-media");
  await page.locator("#spa-media").focus();

  await page.evaluate(() => history.pushState({}, "", "/shorts/clip"));
  await page.keyboard.press("k");

  await expect.poll(() => readNativeKeyCount(page)).toBe(1);
  expect((await readMediaState(page, "spa-media")).paused).toBe(true);

  await page.evaluate(() => history.pushState({}, "", "/watch/next"));
  await page.keyboard.press("k");

  await waitForMediaState(page, "spa-media", (state) => !state.paused);
  expect(await readNativeKeyCount(page)).toBe(1);
});

test("an embed added after the page loaded inherits a disabled site rule", async ({
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await page.locator("#add-site-policy").click();
  await page.locator(".site-policy-pattern").fill("127.0.0.1");
  await expect(page.locator("#announcements .announcement").last()).toContainText(
    "Settings saved.",
  );

  await page.goto(server.getUrl("/"));
  await page.evaluate(() => {
    const iframe = document.createElement("iframe");
    iframe.id = "late-frame";
    iframe.src = "/iframe-video";
    document.body.appendChild(iframe);
  });
  const frame = await (await page.locator("#late-frame").elementHandle())?.contentFrame();
  expect(frame).toBeTruthy();
  await frame!.locator("#frame-video").waitFor();
  await frame!.evaluate(() => {
    const testWindow = window as typeof window & { keysLeftToPage?: number };
    window.addEventListener("keydown", (event) => {
      if (event.key === "k" && !event.defaultPrevented) {
        testWindow.keysLeftToPage = (testWindow.keysLeftToPage ?? 0) + 1;
      }
    });
  });
  // Give the frame's content script time to start and hear from the parent.
  await page.waitForTimeout(500);

  await frame!.locator("#frame-video").press("k");

  await expect
    .poll(() =>
      frame!.evaluate(
        () => (window as typeof window & { keysLeftToPage?: number }).keysLeftToPage ?? 0,
      ),
    )
    .toBe(1);
  expect((await readFrameMediaState(frame!, "frame-video")).paused).toBe(true);
});
