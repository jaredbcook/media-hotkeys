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

test("allows bound keys to type in a textarea when no media exists", async ({ page }) => {
  await createEditable(page, "textarea", "message");

  const textarea = page.locator("#message");
  await textarea.focus();
  await page.keyboard.press("k");

  await expect(textarea).toHaveValue("k");
});

test("allows bound keys to type in a shadow DOM textarea when no media exists", async ({
  page,
}) => {
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "shadow-editor";

    const shadowRoot = host.attachShadow({ mode: "open" });
    const textarea = document.createElement("textarea");
    textarea.id = "shadow-message";
    shadowRoot.appendChild(textarea);

    document.getElementById("app")?.appendChild(host);
  });

  const textarea = page.locator("#shadow-editor textarea");
  await textarea.focus();
  await page.keyboard.press("k");

  await expect(textarea).toHaveValue("k");
});
