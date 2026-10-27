import type { Page } from "@playwright/test";
import { expect, test } from "../setup.js";
import { createMedia } from "../fixtures.js";

async function makePageScrollable(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    document.body.appendChild(spacer);
  });
}

async function recordPageKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keys: string[] = [];
    (window as typeof window & { __pageKeys: string[] }).__pageKeys = keys;
    window.addEventListener("keydown", (event) => keys.push(event.key));
  });
}

async function readPageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as typeof window & { __pageKeys: string[] }).__pageKeys);
}

test("leaves arrow scrolling and page shortcuts alone when the page has no media", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/"));
  await makePageScrollable(page);
  await recordPageKeys(page);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("j");
  await page.keyboard.press("k");

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await readPageKeys(page)).toEqual(["ArrowDown", "j", "k"]);
});

test("leaves arrow keys alone next to an iframe without media", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-cued-embed"));
  await makePageScrollable(page);
  await recordPageKeys(page);
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  await page.keyboard.press("ArrowDown");

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await readPageKeys(page)).toEqual(["ArrowDown"]);
});

test("takes mapped keys from the page once media exists", async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
  await makePageScrollable(page);
  await createMedia(page, "primary", { currentTime: 25, duration: 100 });
  await recordPageKeys(page);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("j");

  expect(await readPageKeys(page)).toEqual([]);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
