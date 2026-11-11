import { expect, test } from "../setup.js";
import { createMedia, waitForMediaState } from "../fixtures.js";
import { openOverlayReader } from "../overlay.js";

// Broad selectors like these are what the shadow root and the host's
// `!important` styles are there to withstand. `#app` holds the media, so it is
// spared to keep the overlay anchored to the same video.
const HOSTILE_PAGE_CSS = `
  * { box-sizing: border-box !important; letter-spacing: 6px !important; }
  div:not(#app), span, svg, path {
    display: none !important;
    position: static !important;
    background: red !important;
    color: red !important;
    font: italic 60px/3 serif !important;
    padding: 40px !important;
    margin: 40px !important;
    border: 8px solid red !important;
    opacity: 0.1 !important;
    transform: rotate(45deg) !important;
    width: 3px !important;
    height: 3px !important;
    fill: red !important;
  }
`;

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("draws the overlay inside a closed shadow root the page can't see into", async ({ page }) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "primary", {}, "video");
  await page.locator("#primary").focus();

  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => !state.paused);

  await expect.poll(async () => (await overlay.read())?.iconPath).toContain("M320-273v-414");
  const snapshot = await overlay.read();
  expect(snapshot?.pageSees).toEqual({ shadowRoot: false, text: "", descendants: 0 });
  await expect(page.locator("#media-hotkeys-overlay svg")).toHaveCount(0);
});

test("keeps its look and place when the page styles div, span, svg, and path", async ({ page }) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "primary", {}, "video");
  await page.locator("#primary").focus();

  // Play and pause show different icons of the same size, so the first press
  // gives the look to hold the second one against.
  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => !state.paused);
  await expect.poll(async () => (await overlay.read())?.visible).toBe(true);
  const clean = (await overlay.read())!;
  expect(clean.box).toMatchObject({
    background: "rgba(0, 0, 0, 0.6)",
    color: "rgb(255, 255, 255)",
    padding: "8px 16px",
    borderRadius: "10px",
  });
  await expect.poll(async () => (await overlay.read())?.visible).toBe(false);

  await page.addStyleTag({ content: HOSTILE_PAGE_CSS });
  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => state.paused);
  await expect.poll(async () => (await overlay.read())?.visible).toBe(true);

  const hostile = (await overlay.read())!;
  expect(hostile.box).toEqual(clean.box);
  expect(hostile.host).toEqual(clean.host);
  expect(hostile.iconPath).toContain("M640-200q-33 0");
});
