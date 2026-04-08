import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packagesDir = path.join(distRoot, "packages");
const supportedBrowsers = ["chrome", "firefox", "safari"];
const browserArgs = getBrowserArgs(process.argv.slice(2));

await run();

async function run() {
  ensureZipAvailable();

  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const browsers = browserArgs.length > 0 ? browserArgs : supportedBrowsers;

  await mkdir(packagesDir, { recursive: true });
  await buildBrowsers(browsers);

  for (const browser of browsers) {
    const extension = browser === "firefox" ? "xpi" : "zip";
    const archiveName = `${packageJson.name}-${browser}-v${packageJson.version}.${extension}`;
    const archivePath = path.join(packagesDir, archiveName);
    const sourceDir = path.join(distRoot, browser);

    await rm(archivePath, { force: true });

    const result = spawnSync("zip", ["-rq", archivePath, "."], {
      cwd: sourceDir,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Packaging failed for ${browser}`);
    }
  }
}

async function buildBrowsers(browsers) {
  const buildScriptPath = path.join(projectRoot, "scripts", "build.js");

  for (const browser of browsers) {
    const result = spawnSync("node", [buildScriptPath, "--browser", browser], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Build failed for ${browser}`);
    }
  }
}

function ensureZipAvailable() {
  const result = spawnSync("zip", ["-v"], {
    stdio: "ignore",
  });

  if (result.status !== 0) {
    throw new Error("The zip command is required to package extension builds.");
  }
}

function getBrowserArgs(args) {
  const browsers = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--browser") {
      const browser = args[index + 1];
      if (!browser) {
        throw new Error("Expected a browser name after --browser");
      }
      browsers.push(assertBrowser(browser));
      index += 1;
      continue;
    }

    if (arg.startsWith("--browser=")) {
      const browser = arg.split("=", 2)[1];
      browsers.push(assertBrowser(browser));
    }
  }

  return [...new Set(browsers)];
}

function assertBrowser(browser) {
  if (!supportedBrowsers.includes(browser)) {
    throw new Error(
      `Unsupported browser "${browser}". Expected one of: ${supportedBrowsers.join(", ")}`,
    );
  }

  return browser;
}

async function readJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents);
}
