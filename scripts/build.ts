import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";
import { createViteConfigs } from "../vite.config.js";
import {
  distRoot,
  getBrowserDistDir,
  getManifestTemplatePath,
  getPackageJsonPath,
  getScriptArgv,
  projectRoot,
  readJsonFile,
  resolveBrowsers,
  type ManifestTemplate,
  type PackageJson,
  type SupportedBrowser,
} from "./shared.js";

export async function buildBrowsers(browsers: SupportedBrowser[]): Promise<void> {
  const [packageJson, manifestTemplate] = await Promise.all([
    readJsonFile<PackageJson>(getPackageJsonPath()),
    readJsonFile<ManifestTemplate>(getManifestTemplatePath()),
  ]);

  await mkdir(distRoot, { recursive: true });

  for (const browser of browsers) {
    await buildBrowser(browser, packageJson, manifestTemplate);
  }
}

async function buildBrowser(
  browser: SupportedBrowser,
  packageJson: PackageJson,
  manifestTemplate: ManifestTemplate,
): Promise<void> {
  const outDir = getBrowserDistDir(browser);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const viteConfig of createViteConfigs(outDir)) {
    await viteBuild({
      ...viteConfig,
      mode: browser,
      configFile: false,
    });
  }

  await Promise.all([
    cp(path.join(projectRoot, "src", "popup.html"), path.join(outDir, "popup.html")),
    cp(path.join(projectRoot, "src", "options.html"), path.join(outDir, "options.html")),
    cp(path.join(projectRoot, "src", "ui.css"), path.join(outDir, "ui.css")),
    cp(path.join(projectRoot, "src", "settings"), path.join(outDir, "settings"), {
      recursive: true,
    }),
    copyIcons(outDir),
    writeManifest(browser, outDir, packageJson, manifestTemplate),
  ]);
}

async function copyIcons(outDir: string): Promise<void> {
  const iconSizes = [16, 32, 48, 128];

  await mkdir(path.join(outDir, "assets"), { recursive: true });

  for (const size of iconSizes) {
    await cp(
      path.join(projectRoot, "assets", `icon${size}.png`),
      path.join(outDir, "assets", `icon${size}.png`),
    );
  }
}

async function writeManifest(
  browser: SupportedBrowser,
  outDir: string,
  packageJson: PackageJson,
  manifestTemplate: ManifestTemplate,
): Promise<void> {
  const manifest = createManifest({ browser, packageJson, manifestTemplate });
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function createManifest({
  browser,
  packageJson,
  manifestTemplate,
}: {
  browser: SupportedBrowser;
  packageJson: PackageJson;
  manifestTemplate: ManifestTemplate;
}): ManifestTemplate & { version: string } {
  const manifest = structuredClone(manifestTemplate) as ManifestTemplate & { version: string };

  manifest.version = packageJson.version;
  manifest.icons = {
    16: "assets/icon16.png",
    32: "assets/icon32.png",
    48: "assets/icon48.png",
    128: "assets/icon128.png",
  };

  if (browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: `${packageJson.name}@local`,
      },
    };
  } else {
    delete manifest.browser_specific_settings;
  }

  return manifest;
}

async function run(): Promise<void> {
  const browsers = resolveBrowsers(getScriptArgv());
  await buildBrowsers(browsers);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
