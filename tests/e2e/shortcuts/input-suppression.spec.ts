import { expect, test } from "../setup.js";
import { createEditable, createMedia, readMediaState } from "../fixtures.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("suppresses hotkeys while typing in editable elements", async ({ page }) => {
  await createMedia(page, "primary");

  for (const kind of ["input", "textarea", "select", "contenteditable"] as const) {
    await createEditable(page, kind, kind);
    await page.locator(`#${kind}`).focus();
    await page.keyboard.press("k");
    await expect.poll(async () => (await readMediaState(page, "primary")).paused).toBe(true);
  }
});
