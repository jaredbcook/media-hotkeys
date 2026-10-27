import { expect, test } from "../setup.js";
import { readFrameMediaState, readMediaState } from "../fixtures.js";

test("activates a duration-less cued embed placeholder inside an iframe", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-cued-embed"));

  const frameHandle = await page.locator("#embed-frame").elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();
  await expect(frame!.locator("#cued-play")).toHaveCount(1);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("k");

  await expect(frame!.locator("#cued-media")).toHaveCount(1);
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "cued-media")).paused)
    .toBe(false);
});

test("activates a lite-youtube-style facade labeled only by visually hidden text", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/lite-facade"));

  await page.keyboard.press("k");

  await expect(page.locator("#facade-media")).toHaveCount(1);
  await expect.poll(async () => (await readMediaState(page, "facade-media")).paused).toBe(false);
});

test("does not navigate away by clicking a thumbnail card that links to another page", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/link-card-grid"));

  await page.keyboard.press("k");
  // Placeholder activation waits up to ~1s for media; give a navigation time to start.
  await page.waitForTimeout(1500);

  expect(new URL(page.url()).pathname).toBe("/link-card-grid");
  await expect(page.locator("#card")).toHaveCount(1);
});
