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
        const overlay = document.getElementById("media-shortcuts-overlay");
        return overlay ? getComputedStyle(overlay).display : "none";
      });
    })
    .toBe("none");
});
