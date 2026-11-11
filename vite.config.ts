import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

interface BundleSpec {
  entry: string;
  fileName: string;
  format: "iife" | "es";
  name?: string;
}

const BUNDLE_SPECS: readonly BundleSpec[] = [
  {
    entry: "src/content.ts",
    fileName: "content.js",
    format: "iife",
    name: "MediaHotkeysContent",
  },
  {
    entry: "src/player-bridge.ts",
    fileName: "player-bridge.js",
    format: "iife",
    name: "MediaHotkeysPlayerBridge",
  },
  {
    entry: "src/quick-settings-popup.ts",
    fileName: "quick-settings-popup.js",
    format: "es",
  },
  {
    entry: "src/advanced-settings-page.ts",
    fileName: "advanced-settings-page.js",
    format: "es",
  },
];

function createBundleConfig(outDir: string, minify: boolean, spec: BundleSpec): UserConfig {
  // Vite keeps whitespace in ES-format library output unless Rolldown is told to minify it too.
  const rolldownOptions =
    spec.format === "es" ? (minify ? { output: { minify: true } } : {}) : undefined;

  return {
    publicDir: false,
    build: {
      emptyOutDir: false,
      minify,
      outDir,
      sourcemap: false,
      lib: {
        entry: path.resolve(projectRoot, spec.entry),
        formats: [spec.format],
        ...(spec.name ? { name: spec.name } : {}),
        fileName: () => spec.fileName,
      },
      ...(rolldownOptions ? { rolldownOptions } : {}),
    },
  };
}

export function createViteConfigs(outDir: string, minify = true): UserConfig[] {
  return BUNDLE_SPECS.map((spec) => createBundleConfig(outDir, minify, spec));
}

export default createViteConfigs(process.env.BUILD_OUT_DIR ?? "dist/chrome");
