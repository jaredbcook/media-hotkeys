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

async function addSitePolicy(
  page: Page,
  entry: string,
  savedPattern: string,
  mode: "disabled" | "enabled" = "disabled",
): Promise<void> {
  // A click before the options page has attached its listeners adds nothing, so click again.
  const rows = page.locator(".site-policy-row");
  const rowCount = await rows.count();
  await expect(async () => {
    if ((await rows.count()) === rowCount) {
      await page.locator("#add-site-policy").click();
    }
    await expect(rows).toHaveCount(rowCount + 1, { timeout: 1000 });
  }).toPass();
  const row = rows.last();
  await row.locator(".site-policy-mode").selectOption(mode);
  const patternInput = row.locator(".site-policy-pattern");
  await patternInput.fill(entry);
  // Saving rewrites the entry as the saved rule.
  await expect(patternInput).toHaveValue(savedPattern);
}

/** Rules autosave after a pause, and an entry already in its saved form shows no sign of it. */
async function waitForSavedPolicies(page: Page, patterns: string[]): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const extensionApi = (
          globalThis as unknown as {
            chrome: {
              storage: {
                sync: {
                  get(keys: null): Promise<{ sitePolicies?: { pattern: string }[] }>;
                };
              };
            };
          }
        ).chrome;
        const stored = await extensionApi.storage.sync.get(null);
        return (stored.sitePolicies ?? []).map((policy) => policy.pattern);
      }),
    )
    .toEqual(patterns);
}

async function expectKeyHandling(
  page: Page,
  port: string,
  cases: { host: string; path?: string; disabled: boolean }[],
): Promise<void> {
  for (const [index, { host, path = "/", disabled }] of cases.entries()) {
    const url = `http://${host}:${port}${path}`;
    const mediaId = `media-${index}`;
    await page.goto(url);
    await addNativeKeyCounter(page);
    await createMedia(page, mediaId);
    await page.locator(`#${mediaId}`).focus();
    await page.keyboard.press("k");

    if (disabled) {
      await expect.poll(() => readNativeKeyCount(page), { message: url }).toBe(1);
      expect((await readMediaState(page, mediaId)).paused, url).toBe(true);
    } else {
      await waitForMediaState(page, mediaId, (state) => !state.paused);
      expect(await readNativeKeyCount(page), url).toBe(0);
    }
  }
}

test("a host rule covers its subdomains but not other sites on a shared host", async ({
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await addSitePolicy(page, "https://www.video.example.co.uk/watch", "video.example.co.uk/watch");
  await addSitePolicy(page, "www.alice.github.io", "alice.github.io");
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator(".site-policy-pattern")
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
    )
    .toEqual(["alice.github.io", "video.example.co.uk/watch"]);

  await expectKeyHandling(page, new URL(server.url).port, [
    { host: "video.example.co.uk", path: "/watch", disabled: true },
    { host: "www.video.example.co.uk", path: "/watch", disabled: true },
    { host: "a.video.example.co.uk", path: "/watch", disabled: true },
    { host: "video.example.co.uk", path: "/shorts", disabled: false },
    { host: "example.co.uk", path: "/watch", disabled: false },
    { host: "other.example.co.uk", path: "/watch", disabled: false },
    { host: "alice.github.io", disabled: true },
    { host: "www.alice.github.io", disabled: true },
    { host: "bob.github.io", disabled: false },
  ]);
});

test("the more specific host wins over a domain rule, and a bare private suffix covers its sites", async ({
  page,
  server,
}) => {
  const extensionId = await getExtensionId(page);
  await page.goto(`chrome-extension://${extensionId}/advanced-settings-page.html`);
  await addSitePolicy(page, "www.example.co.uk", "example.co.uk");
  await addSitePolicy(page, "video.example.co.uk", "video.example.co.uk", "enabled");
  await addSitePolicy(page, "github.io", "github.io");
  await waitForSavedPolicies(page, ["example.co.uk", "github.io", "video.example.co.uk"]);

  await expectKeyHandling(page, new URL(server.url).port, [
    { host: "example.co.uk", disabled: true },
    { host: "other.example.co.uk", disabled: true },
    { host: "video.example.co.uk", disabled: false },
    { host: "a.video.example.co.uk", disabled: false },
    { host: "alice.github.io", disabled: true },
    { host: "bob.github.io", disabled: true },
  ]);
});
