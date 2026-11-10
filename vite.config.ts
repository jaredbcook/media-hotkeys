import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

export function createViteConfigs(outDir: string, minify = true): UserConfig[] {
  // Vite keeps whitespace in ES-format library output unless Rolldown is told to minify it too.
  const esOutput = minify ? { output: { minify: true } } : {};

  return [
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/content.ts"),
          formats: ["iife"],
          name: "MediaHotkeysContent",
          fileName: () => "content.js",
        },
      },
    },
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/player-bridge.ts"),
          formats: ["iife"],
          name: "MediaHotkeysPlayerBridge",
          fileName: () => "player-bridge.js",
        },
      },
    },
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/quick-settings-popup.ts"),
          formats: ["es"],
          fileName: () => "quick-settings-popup.js",
        },
        rolldownOptions: esOutput,
      },
    },
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/advanced-settings-page.ts"),
          formats: ["es"],
          fileName: () => "advanced-settings-page.js",
        },
        rolldownOptions: esOutput,
      },
    },
  ];
}

export default createViteConfigs(process.env.BUILD_OUT_DIR ?? "dist/chrome");
