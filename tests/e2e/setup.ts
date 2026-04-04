import { chromium, BrowserContext, Page } from "@playwright/test";
import path from "path";

export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const extensionPath = path.resolve("dist/chrome");

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const page = await context.newPage();
  return { context, page };
}
