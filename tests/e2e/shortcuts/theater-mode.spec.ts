import { expect, test } from "../setup.js";
import { attachVideoTrack, createMedia } from "../fixtures.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

type TheaterSnapshot = {
  open: boolean;
  parentId: string | undefined;
  rect: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
  topLeftHitId: string | undefined;
  scrollY: number;
};

async function readTheaterSnapshot(
  page: import("@playwright/test").Page,
): Promise<TheaterSnapshot> {
  return page.evaluate(() => {
    const video = document.getElementById("theater-video")!;
    const rect = video.getBoundingClientRect();
    return {
      open: video.matches(":popover-open"),
      parentId: video.parentElement?.id,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      topLeftHitId: document.elementFromPoint(5, 5)?.id,
      scrollY: window.scrollY,
    };
  });
}

test("theater mode fills the viewport above page chrome and Esc restores the video", async ({
  page,
}) => {
  await page.evaluate(() => {
    const header = document.createElement("header");
    header.id = "sticky-header";
    Object.assign(header.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      height: "60px",
      zIndex: "99999",
      background: "red",
    });
    document.body.prepend(header);

    // A transformed, clipped ancestor would trap a position:fixed video.
    const frame = document.createElement("div");
    frame.id = "player-frame";
    Object.assign(frame.style, {
      marginTop: "1200px",
      overflow: "hidden",
      transform: "translateZ(0)",
      width: "320px",
      height: "180px",
    });
    document.getElementById("app")!.appendChild(frame);

    const spacer = document.createElement("div");
    spacer.style.height = "1200px";
    document.getElementById("app")!.appendChild(spacer);
  });
  await createMedia(page, "theater-video", {}, "video");
  await page.evaluate(() => {
    document.getElementById("player-frame")!.appendChild(document.getElementById("theater-video")!);
    document.getElementById("theater-video")!.scrollIntoView({ block: "center" });
  });
  await page.locator("#theater-video").focus();
  const initialScrollY = await page.evaluate(() => window.scrollY);

  await page.keyboard.press("t");

  const theater = await readTheaterSnapshot(page);
  expect(theater.open).toBe(true);
  expect(theater.parentId).toBe("player-frame");
  expect(theater.rect).toEqual({
    left: 0,
    top: 0,
    width: theater.viewport.width,
    height: theater.viewport.height,
  });
  expect(theater.topLeftHitId).toBe("theater-video");

  await page.keyboard.press("m");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getElementById("media-hotkeys-overlay")?.matches(":popover-open"),
      ),
    )
    .toBe(true);

  await page.keyboard.press("Escape");

  const restored = await readTheaterSnapshot(page);
  expect(restored.open).toBe(false);
  expect(restored.parentId).toBe("player-frame");
  expect(restored.rect.width).toBe(320);
  expect(restored.rect.height).toBe(180);
  expect(restored.topLeftHitId).toBe("sticky-header");
  expect(restored.scrollY).toBe(initialScrollY);
  expect(
    await page.evaluate(
      () => (document.getElementById("theater-video") as HTMLVideoElement).controls,
    ),
  ).toBe(false);
});

test("pressing t again exits theater mode", async ({ page }) => {
  await createMedia(page, "theater-video", {}, "video");
  await page.locator("#theater-video").focus();

  await page.keyboard.press("t");
  expect((await readTheaterSnapshot(page)).open).toBe(true);

  await page.keyboard.press("t");
  expect((await readTheaterSnapshot(page)).open).toBe(false);
});

test("theater mode works in a document without a head", async ({ page, server }) => {
  await page.goto(server.getUrl("/svg-document"));
  await page.waitForFunction(() => {
    const video = document.getElementById("svg-video") as HTMLVideoElement | null;
    return Boolean(video && video.readyState >= 1);
  });
  expect(await page.evaluate(() => document.head)).toBeNull();
  await page.locator("#svg-video").focus();

  await page.keyboard.press("t");

  const theater = await page.evaluate(() => {
    const video = document.getElementById("svg-video")!;
    const rect = video.getBoundingClientRect();
    return {
      open: video.matches(":popover-open"),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      styles: document.querySelectorAll("style[data-media-hotkeys-theater-style]").length,
    };
  });
  expect(theater.open).toBe(true);
  expect(theater.styles).toBe(1);
  expect({ width: theater.width, height: theater.height }).toEqual(theater.viewport);

  await page.keyboard.press("Escape");

  const restored = await page.evaluate(() => {
    const video = document.getElementById("svg-video")!;
    const rect = video.getBoundingClientRect();
    return {
      open: video.matches(":popover-open"),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  expect(restored).toEqual({ open: false, width: 320, height: 180 });
});

type PromotionState = { promoted: boolean; width: number; height: number };

async function readPromotion(
  target: import("@playwright/test").Page | import("@playwright/test").Frame,
  selector: string,
): Promise<PromotionState> {
  return target.evaluate((elementSelector) => {
    const element = document.querySelector(elementSelector)!;
    const rect = element.getBoundingClientRect();
    return {
      promoted: element.matches(":popover-open"),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, selector);
}

async function waitForFrame(
  page: import("@playwright/test").Page,
  path: string,
): Promise<import("@playwright/test").Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().endsWith(path))).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().endsWith(path))!;
  await frame.waitForFunction(() => {
    const video = document.getElementById("frame-video") as HTMLVideoElement | null;
    return Boolean(video && video.readyState >= 1);
  });
  return frame;
}

test("theater mode enlarges the iframe hosting the target video", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-video-iframe"));
  const frame = await waitForFrame(page, "/iframe-video");
  const viewport = page.viewportSize()!;

  await page.keyboard.press("t");

  await expect
    .poll(() => readPromotion(page, "#video-frame"))
    .toEqual({
      promoted: true,
      width: viewport.width,
      height: viewport.height,
    });
  await expect
    .poll(() => readPromotion(frame, "#frame-video"))
    .toEqual({
      promoted: true,
      width: viewport.width,
      height: viewport.height,
    });

  await page.keyboard.press("Escape");

  await expect
    .poll(() => readPromotion(page, "#video-frame"))
    .toEqual({ promoted: false, width: 480, height: 270 });
  await expect
    .poll(() => readPromotion(frame, "#frame-video"))
    .toEqual({ promoted: false, width: 320, height: 180 });
});

test("theater mode enlarges every iframe in a nested chain", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-nested-video-iframe"));
  const leaf = await waitForFrame(page, "/iframe-video");
  const middle = page.frames().find((frame) => frame.url().endsWith("/page-with-video-iframe"))!;
  const viewport = page.viewportSize()!;
  const fullViewport = { promoted: true, width: viewport.width, height: viewport.height };

  await page.keyboard.press("t");

  await expect.poll(() => readPromotion(page, "#outer-frame")).toEqual(fullViewport);
  await expect.poll(() => readPromotion(middle, "#video-frame")).toEqual(fullViewport);
  await expect.poll(() => readPromotion(leaf, "#frame-video")).toEqual(fullViewport);

  // Exiting from the innermost frame unwinds every level.
  await leaf.locator("#frame-video").focus();
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPromotion(page, "#outer-frame")).promoted).toBe(false);
  await expect.poll(async () => (await readPromotion(middle, "#video-frame")).promoted).toBe(false);
  await expect.poll(async () => (await readPromotion(leaf, "#frame-video")).promoted).toBe(false);
});

test("an unfocused iframe cannot ask to be enlarged without a routed theater action", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-video-iframe"));
  const frame = await waitForFrame(page, "/iframe-video");

  await frame.evaluate(() => {
    window.parent.postMessage(
      {
        source: "media-hotkeys-extension",
        type: "MEDIA_HOTKEYS_THEATER",
        active: true,
        requestId: "forged",
      },
      "*",
    );
  });
  await page.waitForTimeout(200);

  expect((await readPromotion(page, "#video-frame")).promoted).toBe(false);
});

test("pressing t again from the top page exits iframe theater mode", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-video-iframe"));
  const frame = await waitForFrame(page, "/iframe-video");

  await page.keyboard.press("t");
  await expect.poll(async () => (await readPromotion(page, "#video-frame")).promoted).toBe(true);

  await page.keyboard.press("t");

  await expect.poll(async () => (await readPromotion(page, "#video-frame")).promoted).toBe(false);
  await expect.poll(async () => (await readPromotion(frame, "#frame-video")).promoted).toBe(false);
});

test("pressing t with focus inside the embed enlarges its iframe", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-video-iframe"));
  const frame = await waitForFrame(page, "/iframe-video");
  const viewport = page.viewportSize()!;
  const fullViewport = { promoted: true, width: viewport.width, height: viewport.height };

  await frame.locator("#frame-video").focus();
  await page.keyboard.press("t");

  await expect.poll(() => readPromotion(page, "#video-frame")).toEqual(fullViewport);
  await expect.poll(() => readPromotion(frame, "#frame-video")).toEqual(fullViewport);

  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPromotion(page, "#video-frame")).promoted).toBe(false);
  await expect.poll(async () => (await readPromotion(frame, "#frame-video")).promoted).toBe(false);
});

test("pressing t with focus inside a nested embed enlarges every level", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-nested-video-iframe"));
  const leaf = await waitForFrame(page, "/iframe-video");
  const middle = page.frames().find((frame) => frame.url().endsWith("/page-with-video-iframe"))!;
  const viewport = page.viewportSize()!;
  const fullViewport = { promoted: true, width: viewport.width, height: viewport.height };

  await leaf.locator("#frame-video").focus();
  await page.keyboard.press("t");

  await expect.poll(() => readPromotion(page, "#outer-frame")).toEqual(fullViewport);
  await expect.poll(() => readPromotion(middle, "#video-frame")).toEqual(fullViewport);
  await expect.poll(() => readPromotion(leaf, "#frame-video")).toEqual(fullViewport);
});

async function readPictureInPictureId(
  target: import("@playwright/test").Page | import("@playwright/test").Frame,
): Promise<string | null> {
  return target.evaluate(() => document.pictureInPictureElement?.id ?? null);
}

test("entering picture-in-picture with the hotkey exits theater mode", async ({ page }) => {
  await createMedia(page, "theater-video", {}, "video");
  await attachVideoTrack(page, "theater-video");
  await page.locator("#theater-video").focus();
  await page.keyboard.press("t");
  expect((await readTheaterSnapshot(page)).open).toBe(true);

  await page.keyboard.press("i");

  await expect.poll(() => readPictureInPictureId(page)).toBe("theater-video");
  const snapshot = await readTheaterSnapshot(page);
  expect(snapshot.open).toBe(false);
  expect(snapshot.rect.width).toBe(320);
  expect(snapshot.topLeftHitId).not.toBe("theater-video");
  expect(
    await page.evaluate(() => document.getElementById("theater-video")!.hasAttribute("popover")),
  ).toBe(false);
});

test("picture-in-picture started by the page exits theater mode", async ({ page }) => {
  await createMedia(page, "theater-video", {}, "video");
  await attachVideoTrack(page, "theater-video");
  await page.locator("#theater-video").focus();
  await page.keyboard.press("t");
  expect((await readTheaterSnapshot(page)).open).toBe(true);

  // The key press is the user activation the request needs, as a click on the
  // page's own control would be. The browser's button fires the same event.
  await page.evaluate(() =>
    (document.getElementById("theater-video") as HTMLVideoElement).requestPictureInPicture(),
  );

  await expect.poll(async () => (await readTheaterSnapshot(page)).open).toBe(false);
  expect(await readPictureInPictureId(page)).toBe("theater-video");
});

test("a rejected picture-in-picture request keeps theater mode open", async ({ page }) => {
  // The fixture media has no video track, so the browser refuses PiP.
  await createMedia(page, "theater-video", {}, "video");
  await page.locator("#theater-video").focus();
  await page.keyboard.press("t");

  await page.keyboard.press("i");
  await page.waitForTimeout(300);

  expect((await readTheaterSnapshot(page)).open).toBe(true);
  expect(await readPictureInPictureId(page)).toBeNull();
});

test("entering theater mode brings the video back from picture-in-picture", async ({ page }) => {
  await createMedia(page, "theater-video", {}, "video");
  await attachVideoTrack(page, "theater-video");
  await page.locator("#theater-video").focus();
  await page.keyboard.press("i");
  await expect.poll(() => readPictureInPictureId(page)).toBe("theater-video");

  await page.keyboard.press("t");

  await expect.poll(() => readPictureInPictureId(page)).toBeNull();
  expect((await readTheaterSnapshot(page)).open).toBe(true);
});

test("picture-in-picture exits iframe theater mode in both frames", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-video-iframe"));
  const frame = await waitForFrame(page, "/iframe-video");
  await attachVideoTrack(frame, "frame-video");
  await page.keyboard.press("t");
  await expect.poll(async () => (await readPromotion(page, "#video-frame")).promoted).toBe(true);
  await expect.poll(async () => (await readPromotion(frame, "#frame-video")).promoted).toBe(true);

  await page.keyboard.press("i");

  await expect.poll(() => readPictureInPictureId(frame)).toBe("frame-video");
  await expect.poll(async () => (await readPromotion(page, "#video-frame")).promoted).toBe(false);
  await expect.poll(async () => (await readPromotion(frame, "#frame-video")).promoted).toBe(false);
  expect(await readPromotion(page, "#video-frame")).toMatchObject({ width: 480, height: 270 });
});
