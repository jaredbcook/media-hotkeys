import type { Frame, Page } from "@playwright/test";
import { expect, test } from "../setup.js";
import { createMedia, waitForMediaState } from "../fixtures.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("hides overlays after the overlay hotkey toggles them off", async ({ page }) => {
  await createMedia(page, "primary", {
    currentTime: 25,
    duration: 100,
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("o");
  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => !state.paused);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const overlay = document.getElementById("media-hotkeys-overlay");
        return overlay ? getComputedStyle(overlay).display : "none";
      });
    })
    .toBe("none");
});

type ContentScriptWorld = { id: number; name: string; auxData?: { type?: string } };

/**
 * Wraps `chrome.storage.sync.set` in the content script of every frame of the
 * page, so the test can count the writes each frame makes. Content scripts run
 * in isolated worlds that only the DevTools protocol can reach.
 */
async function countSyncWrites(
  page: Page,
  frameCount: number,
): Promise<{ readWriteCounts: () => Promise<number[]>; readShowOverlays: () => Promise<boolean> }> {
  const session = await page.context().newCDPSession(page);
  const worlds: ContentScriptWorld[] = [];
  session.on("Runtime.executionContextCreated", ({ context }) => {
    worlds.push(context as ContentScriptWorld);
  });
  await session.send("Runtime.enable");

  const evaluate = async (world: ContentScriptWorld, expression: string): Promise<unknown> => {
    const { result } = await session.send("Runtime.evaluate", {
      contextId: world.id,
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.value;
  };
  const contentScriptWorlds = (): ContentScriptWorld[] =>
    worlds.filter((world) => world.auxData?.type === "isolated" && world.name === "Media Hotkeys");

  await expect.poll(() => contentScriptWorlds().length).toBe(frameCount);
  for (const world of contentScriptWorlds()) {
    await evaluate(
      world,
      `(() => {
        const set = chrome.storage.sync.set;
        globalThis.__syncWriteCount = 0;
        chrome.storage.sync.set = function (...args) {
          globalThis.__syncWriteCount += 1;
          return set.apply(this, args);
        };
      })()`,
    );
  }

  return {
    readWriteCounts: () =>
      Promise.all(
        contentScriptWorlds().map(
          (world) => evaluate(world, "globalThis.__syncWriteCount") as Promise<number>,
        ),
      ),
    readShowOverlays: () =>
      evaluate(
        contentScriptWorlds()[0],
        "chrome.storage.sync.get(null).then((stored) => stored.advancedSettings.showOverlays)",
      ) as Promise<boolean>,
  };
}

function readOverlayText(frame: Frame): Promise<string | null> {
  return frame.evaluate(() => {
    const overlay = document.getElementById("media-hotkeys-overlay");
    return overlay && getComputedStyle(overlay).display !== "none" ? overlay.textContent : null;
  });
}

test("saves the overlay toggle once per keypress on a page with many frames", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-frame-tree"));
  await createMedia(page, "primary", {}, "video");
  const outerFrame = await (await page.locator("#outer-frame").elementHandle())?.contentFrame();
  const nestedFrame = await (
    await outerFrame?.locator("#video-frame").elementHandle()
  )?.contentFrame();
  expect(nestedFrame).toBeTruthy();
  await expect(page.frameLocator("#video-frame").locator("#frame-video")).toHaveCount(1);
  await expect(page.frameLocator("#audio-frame").locator("#frame-media")).toHaveCount(1);
  await expect(nestedFrame!.locator("#frame-video")).toHaveCount(1);

  // The top frame, its three iframes, and the iframe nested in one of them.
  const writes = await countSyncWrites(page, 5);
  const totalWrites = async (): Promise<number> =>
    (await writes.readWriteCounts()).reduce((total, count) => total + count, 0);

  // Key in the top frame, whose focused video shows the confirmation.
  await page.locator("#primary").focus();
  await page.keyboard.press("o");
  await expect.poll(() => readOverlayText(page.mainFrame())).toBe("Overlays off");
  await expect.poll(() => writes.readShowOverlays()).toBe(false);
  expect(await totalWrites()).toBe(1);

  // Key inside the nested frame, which saves and confirms by itself.
  await nestedFrame!.locator("#frame-video").focus();
  await page.keyboard.press("o");
  await expect.poll(() => readOverlayText(nestedFrame!)).toBe("Overlays on");
  await expect.poll(() => writes.readShowOverlays()).toBe(true);

  // Three quick presses in the top frame end on the third value.
  await page.locator("#primary").focus();
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await page.keyboard.press("o");
  await expect.poll(() => readOverlayText(page.mainFrame())).toBe("Overlays off");
  await expect.poll(() => writes.readShowOverlays()).toBe(false);

  // Give a late or repeated write from any frame time to show up.
  await page.waitForTimeout(500);
  expect(await writes.readWriteCounts()).toHaveLength(5);
  expect(await totalWrites()).toBe(5);
  expect(await writes.readShowOverlays()).toBe(false);
});
