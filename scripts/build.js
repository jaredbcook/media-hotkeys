import { mkdir, mkdtemp, readFile, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const supportedBrowsers = ["chrome", "firefox", "safari"];
const browserArgs = getBrowserArgs(process.argv.slice(2));

await run();

async function run() {
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const sourceManifest = await readJson(path.join(projectRoot, "manifest.json"));
  const browsers = browserArgs.length > 0 ? browserArgs : supportedBrowsers;

  await mkdir(distRoot, { recursive: true });

  for (const browser of browsers) {
    await buildBrowser(browser, packageJson, sourceManifest);
  }
}

async function buildBrowser(browser, packageJson, sourceManifest) {
  const outDir = path.join(distRoot, browser);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await Promise.all([
    bundleEntry({
      entry: path.join(projectRoot, "src", "content.ts"),
      outDir,
      fileName: "content.js",
      name: "MediaShortcutsContent",
    }),
    bundleEntry({
      entry: path.join(projectRoot, "src", "popup.ts"),
      outDir,
      fileName: "popup.js",
      name: "MediaShortcutsPopup",
    }),
    bundleEntry({
      entry: path.join(projectRoot, "src", "options.ts"),
      outDir,
      fileName: "options.js",
      name: "MediaShortcutsOptions",
    }),
    cp(path.join(projectRoot, "src", "popup.html"), path.join(outDir, "popup.html")),
    cp(path.join(projectRoot, "src", "options.html"), path.join(outDir, "options.html")),
    cp(path.join(projectRoot, "src", "ui.css"), path.join(outDir, "ui.css")),
    cp(path.join(projectRoot, "src", "settings"), path.join(outDir, "settings"), {
      recursive: true,
    }),
    copyIcons(outDir),
  ]);

  const manifest = createManifest({
    browser,
    packageJson,
    sourceManifest,
  });

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function bundleEntry({ entry, outDir, fileName, name }) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "media-shortcuts-build-"));

  try {
    await viteBuild({
      configFile: false,
      publicDir: false,
      build: {
        emptyOutDir: false,
        lib: {
          entry,
          formats: ["iife"],
          name,
          fileName: () => fileName,
        },
        outDir: tempDir,
        minify: false,
        sourcemap: false,
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    });

    await cp(path.join(tempDir, fileName), path.join(outDir, fileName));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function copyIcons(outDir) {
  const iconSizes = [16, 32, 48, 128];

  await mkdir(path.join(outDir, "assets"), { recursive: true });

  for (const size of iconSizes) {
    await cp(
      path.join(projectRoot, "assets", `icon${size}.png`),
      path.join(outDir, "assets", `icon${size}.png`)
    );
  }
}

function createManifest({ browser, packageJson, sourceManifest }) {
  const manifest = structuredClone(sourceManifest);

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
  }

  return manifest;
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
      `Unsupported browser "${browser}". Expected one of: ${supportedBrowsers.join(", ")}`
    );
  }

  return browser;
}

async function readJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents);
}
