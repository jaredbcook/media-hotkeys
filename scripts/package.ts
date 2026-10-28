import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ZipArchive } from "archiver";
import { buildBrowsers } from "./build.js";
import {
  getBrowserDistDir,
  getPackageJsonPath,
  getScriptArgv,
  packagesDir,
  readJsonFile,
  resolveBrowsers,
  type PackageJson,
} from "./shared.js";

async function run(): Promise<void> {
  const browsers = resolveBrowsers(getScriptArgv());
  const packageJson = await readJsonFile<PackageJson>(getPackageJsonPath());

  await mkdir(packagesDir, { recursive: true });
  await buildBrowsers(browsers);

  for (const browser of browsers) {
    // Mozilla signs Firefox add-ons when they're uploaded to addons.mozilla.org,
    // so the package built here is named as unsigned.
    const suffix = browser === "firefox" ? "-unsigned.xpi" : ".zip";
    const archiveName = `${packageJson.name}-${browser}-v${packageJson.version}${suffix}`;
    const archivePath = path.join(packagesDir, archiveName);

    await rm(archivePath, { force: true });
    await createArchive(getBrowserDistDir(browser), archivePath);
  }
}

async function createArchive(sourceDir: string, archivePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({
      zlib: { level: 9 },
    });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}

await run();
