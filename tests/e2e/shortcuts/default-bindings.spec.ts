import { expect, test } from "../setup.js";
import {
  createMedia,
  markPlaying,
  pressShiftedKey,
  readMediaState,
  waitForMediaState,
} from "../fixtures.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("toggles play/pause on a focused top-level media element", async ({ page }) => {
  await createMedia(page, "primary");
  await page.locator("#primary").focus();

  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => !state.paused);

  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => state.paused);
});

test("toggles mute and adjusts seek, volume, and speed with default bindings", async ({ page }) => {
  await createMedia(page, "primary", {
    muted: false,
    volume: 0.5,
    playbackRate: 1,
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("m");
  await waitForMediaState(page, "primary", (state) => state.muted);

  await markPlaying(page, "primary");
  await waitForMediaState(page, "primary", (state) => !state.paused);
  const seekBaseline = (await readMediaState(page, "primary")).currentTime;
  await page.keyboard.press("ArrowRight");
  await waitForMediaState(page, "primary", (state) => state.currentTime >= seekBaseline + 4);

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );

  await page.keyboard.press("ArrowDown");
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0) < 0.0001,
  );

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );

  await page.keyboard.press("m");
  await waitForMediaState(page, "primary", (state) => state.muted);

  await pressShiftedKey(page, ".");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1.25) < 0.0001);

  await pressShiftedKey(page, ",");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1) < 0.0001);
});

test("restarts media with the default binding", async ({ page }) => {
  await createMedia(page, "primary", {
    currentTime: 25,
    duration: 100,
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("r");
  await waitForMediaState(page, "primary", (state) => state.currentTime === 0);
});

test("shows overlays while a video is fullscreen", async ({ page }) => {
  await page.evaluate(() => {
    (
      window as typeof window & {
        __mediaFixtures: {
          createMedia: (id: string, tagName?: string, overrides?: Record<string, unknown>) => void;
        };
      }
    ).__mediaFixtures.createMedia("primary", "video");
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("f");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const video = document.getElementById("primary");
        return Boolean(video && document.fullscreenElement?.contains(video));
      }),
    )
    .toBe(true);

  await page.keyboard.press("m");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.getElementById("media-shortcuts-overlay");
        const parent = overlay?.parentElement;
        return {
          display: overlay ? getComputedStyle(overlay).display : "none",
          parentIsFullscreenHost: parent === document.fullscreenElement,
        };
      }),
    )
    .toEqual({
      display: "flex",
      parentIsFullscreenHost: true,
    });
});
