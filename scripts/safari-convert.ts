import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { constants as fsConstants } from "node:fs";
import { buildBrowsers } from "./build.js";
import { getBrowserDistDir, projectRoot } from "./shared.js";

async function run(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Safari conversion is only supported on macOS with Xcode installed.");
  }

  const chromeBuildDir = getBrowserDistDir("chrome");

  try {
    await access(chromeBuildDir, fsConstants.R_OK);
  } catch {
    await buildBrowsers(["chrome"]);
  }

  const command = [
    "xcrun",
    "safari-web-extension-converter",
    path.relative(projectRoot, chromeBuildDir),
    "--no-open",
  ].join(" ");

  process.stdout.write(`${command}\n`);
}

await run();
