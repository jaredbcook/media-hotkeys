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
    },
    "video",
  );
  await createMedia(page, "primary", { volume: 0.5 });

  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "primary", (state) => Math.abs(state.volume - 0.45) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "ambient")).muted).toBe(true);
  await expect.poll(async () => (await readMediaState(page, "ambient")).volume).toBeCloseTo(0.5, 5);
});

test("targets a muted no-controls video when the user focuses it", async ({ page }) => {
  // Direct user intent (focus) outweighs the ambient-media penalty.
  await createMedia(
    page,
    "ambient",
    {
      muted: true,
      controls: false,
    },
    "video",
  );
  await createMedia(page, "primary", { volume: 0.5 });

  await page.locator("#ambient").focus();
  await page.keyboard.press("ArrowUp");

  await waitForMediaState(
    page,
    "ambient",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );
  await expect.poll(async () => (await readMediaState(page, "primary")).volume).toBeCloseTo(0.5, 5);
});

test("keeps targeting a no-controls video after muting it with a shortcut", async ({ page }) => {
  await createMedia(
    page,
    "custom-player-video",
    {
      muted: false,
      controls: false,
      volume: 0.5,
      paused: false,
      ended: false,
      readyState: 4,
    },
    "video",
  );
  await page.locator("#custom-player-video").focus();

  await page.keyboard.press("m");
  await waitForMediaState(page, "custom-player-video", (state) => state.muted);

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(
    page,
    "custom-player-video",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );
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

test("executes an action in exactly one frame when multiple iframes have media", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-two-iframes"));

  const frameA = await (await page.locator("#child-frame-a").elementHandle())?.contentFrame();
  const frameB = await (await page.locator("#child-frame-b").elementHandle())?.contentFrame();
  expect(frameA).not.toBeNull();
  expect(frameB).not.toBeNull();

  await expect(page.frameLocator("#child-frame-a").locator("#frame-media")).toHaveCount(1);
  await expect(page.frameLocator("#child-frame-b").locator("#frame-media")).toHaveCount(1);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("k");

  const countPlaying = async (): Promise<number> => {
    const stateA = await readFrameMediaState(frameA!, "frame-media");
    const stateB = await readFrameMediaState(frameB!, "frame-media");
    return Number(!stateA.paused) + Number(!stateB.paused);
  };

  await expect.poll(countPlaying).toBe(1);

  // Guard against the losing frame starting late.
  await page.waitForTimeout(400);
  expect(await countPlaying()).toBe(1);
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

test("targets the video whose custom player controls the user clicked", async ({ page }) => {
  await createMedia(page, "first", { volume: 0.5 }, "video");
  await createMedia(page, "second", { volume: 0.5 }, "video");

  // Custom players overlay their controls on the video, so clicks land on
  // the overlay rather than on the <video> element itself.
  await page.evaluate(() => {
    const second = document.getElementById("second");
    const box = second?.getBoundingClientRect();
    if (!box) {
      throw new Error("Missing second video");
    }
    const overlay = document.createElement("div");
    overlay.id = "second-controls";
    Object.assign(overlay.style, {
      position: "absolute",
      left: `${box.left + window.scrollX}px`,
      top: `${box.top + window.scrollY}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    document.body.appendChild(overlay);
  });

  await page.locator("#second-controls").click();
  await page.mouse.move(1, 1);
  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "second", (state) => Math.abs(state.volume - 0.45) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "first")).volume).toBeCloseTo(0.5, 5);
});
