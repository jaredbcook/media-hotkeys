import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

export function createViteConfigs(outDir: string): UserConfig[] {
  return [
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify: false,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/content.ts"),
          formats: ["iife"],
          name: "MediaHotkeysContent",
          fileName: () => "content.js",
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    },
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify: false,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/popup.ts"),
          formats: ["es"],
          fileName: () => "popup.js",
        },
      },
    },
    {
      publicDir: false,
      build: {
        emptyOutDir: false,
        minify: false,
        outDir,
        sourcemap: false,
        lib: {
          entry: path.resolve(projectRoot, "src/options.ts"),
          formats: ["es"],
          fileName: () => "options.js",
        },
        rollupOptions: {
          output: {
            format: "es",
          },
        },
      },
    },
  ];
}

export default createViteConfigs(process.env.BUILD_OUT_DIR ?? "dist/chrome");
