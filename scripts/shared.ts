import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type SupportedBrowser = "chrome" | "firefox";

export interface PackageJson {
  name: string;
  version: string;
}

export interface ManifestTemplate {
  manifest_version: number;
  name: string;
  description: string;
  permissions?: string[];
  icons?: Record<string, string>;
  action?: Record<string, unknown>;
  content_scripts?: Array<Record<string, unknown>>;
  options_ui?: Record<string, unknown>;
  browser_specific_settings?: {
    gecko?: {
      id?: string;
      strict_min_version?: string;
    };
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..");
export const distRoot = path.join(projectRoot, "dist");
export const packagesDir = path.join(distRoot, "packages");
export const supportedBrowsers: SupportedBrowser[] = ["chrome", "firefox"];

export function getBrowserArgs(args: string[]): SupportedBrowser[] {
  const browsers: SupportedBrowser[] = [];

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

export function resolveBrowsers(args: string[]): SupportedBrowser[] {
  const browsers = getBrowserArgs(args);
  return browsers.length > 0 ? browsers : supportedBrowsers;
}

export function assertBrowser(browser: string): SupportedBrowser {
  if (!supportedBrowsers.includes(browser as SupportedBrowser)) {
    throw new Error(
      `Unsupported browser "${browser}". Expected one of: ${supportedBrowsers.join(", ")}`,
    );
  }

  return browser as SupportedBrowser;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents) as T;
}

export function getPackageJsonPath(): string {
  return path.join(projectRoot, "package.json");
}

export function getManifestTemplatePath(): string {
  return path.join(projectRoot, "manifest.template.json");
}

export function getBrowserDistDir(browser: SupportedBrowser): string {
  return path.join(distRoot, browser);
}

export function getScriptArgv(): string[] {
  return process.argv.slice(2);
}
