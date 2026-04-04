import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.resolve("dist/chrome")}`,
            `--load-extension=${path.resolve("dist/chrome")}`,
          ],
        },
      },
    },
  ],
});
