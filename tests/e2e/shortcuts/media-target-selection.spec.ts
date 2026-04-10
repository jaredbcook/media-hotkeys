import { expect, test } from "../setup.js";
import {
  createMedia,
  createShadowMedia,
  markInteraction,
  markPlaying,
  readFrameMediaState,
  readMediaState,
  waitForMediaState,
} from "../fixtures.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("prefers the focused media over a playing media element", async ({ page }) => {
  await createMedia(page, "first", { volume: 0.5 });
  await createMedia(page, "second", { volume: 0.8 });
  await markPlaying(page, "second");

  await page.locator("#first").focus();
  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "first", (state) => Math.abs(state.volume - 0.45) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "second")).volume).toBeCloseTo(0.8, 5);
});

test("prefers playing media, then last interacted media, then the first media element", async ({
  page,
}) => {
  await createMedia(page, "first", { volume: 0.5 });
  await createMedia(page, "second", { volume: 0.8 });

  await markPlaying(page, "second");
  await page.keyboard.press("ArrowDown");
  await waitForMediaState(
    page,
    "second",
    (state) => !state.muted && Math.abs(state.volume - 0) < 0.0001,
  );
  await expect.poll(async () => (await readMediaState(page, "first")).volume).toBeCloseTo(0.5, 5);

  await page.evaluate(() => {
    const media = document.getElementById("second") as HTMLMediaElement | null;
    if (media) {
      media.pause();
    }
  });
  await markInteraction(page, "second");
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "second", (state) => Math.abs(state.volume - 0) < 0.0001);

  await page.evaluate(() => {
    const media = document.getElementById("second");
    media?.remove();
  });
  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "first", (state) => Math.abs(state.volume - 0.45) < 0.0001);
});

test("ignores invalid media elements without a source", async ({ page }) => {
  await page.evaluate(() => {
    const invalid = document.createElement("audio");
    invalid.id = "invalid";
    invalid.tabIndex = 0;
    document.getElementById("app")?.appendChild(invalid);
    invalid.focus();
  });
  await createMedia(page, "valid", { volume: 0.5 });

  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "valid", (state) => Math.abs(state.volume - 0.45) < 0.0001);
});

test("ignores muted videos without controls when selecting a target", async ({ page }) => {
  await createMedia(
    page,
    "ambient",
    {
      muted: true,
      controls: false,
      paused: false,
      ended: false,
      readyState: 4,
    },
    "video",
  );
  await createMedia(page, "primary", { volume: 0.5 });

  await page.locator("#ambient").focus();
  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "primary", (state) => Math.abs(state.volume - 0.45) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "ambient")).muted).toBe(true);
  await expect.poll(async () => (await readMediaState(page, "ambient")).volume).toBeCloseTo(0.5, 5);
});

test("delegates actions from the top window into a child iframe", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-iframe"));

  const frameLocator = page.frameLocator("#child-frame");
  await expect(frameLocator.locator("#frame-media")).toHaveCount(1);
  const frameHandle = await page.locator("#child-frame").elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();

  await frame!.locator("#frame-media").press("k");
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "frame-media")).paused)
    .toBe(false);

  await frame!.evaluate(() => {
    const media = document.getElementById("frame-media") as HTMLMediaElement | null;
    media?.pause();
  });
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "frame-media")).paused)
    .toBe(true);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("k");
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "frame-media")).paused)
    .toBe(false);
});

test("controls media added in a shadow root after initialization", async ({ page }) => {
  await createShadowMedia(page, "shadow-host", "shadow-media", { muted: false });

  await page.keyboard.press("m");
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const host = document.getElementById("shadow-host");
        const media = host?.shadowRoot?.getElementById("shadow-media");
        return (
          window as typeof window & {
            __mediaFixtures: { readState: (id: string) => { muted: boolean } };
          }
        ).__mediaFixtures.readState((media as HTMLMediaElement).id).muted;
      });
    })
    .toBe(true);
});

test("controls media added dynamically after page load", async ({ page }) => {
  await createMedia(page, "late-media");

  await page.keyboard.press("k");
  await waitForMediaState(page, "late-media", (state) => !state.paused);
});
