// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createManifest } from "../../../scripts/build.js";
import { createViteConfigs } from "../../../vite.config.js";
import {
  type ManifestTemplate,
  assertBrowser,
  resolveBrowsers,
  resolveMinify,
  supportedBrowsers,
} from "../../../scripts/shared.js";

describe("browser target resolution", () => {
  it("includes Edge as a supported browser target", () => {
    expect(supportedBrowsers).toEqual(["chrome", "edge", "firefox"]);
  });

  it("returns all supported browsers by default", () => {
    expect(resolveBrowsers([])).toEqual(["chrome", "edge", "firefox"]);
  });

  it("parses Edge as an explicit target", () => {
    expect(resolveBrowsers(["--browser", "edge"])).toEqual(["edge"]);
    expect(resolveBrowsers(["--browser=edge"])).toEqual(["edge"]);
  });

  it("deduplicates repeated browser arguments", () => {
    expect(resolveBrowsers(["--browser", "edge", "--browser=edge"])).toEqual(["edge"]);
  });

  it("accepts Edge and rejects unsupported browsers with the full target list", () => {
    expect(assertBrowser("edge")).toBe("edge");
    expect(() => assertBrowser("safari")).toThrow(
      'Unsupported browser "safari". Expected one of: chrome, edge, firefox',
    );
  });
});

describe("minification", () => {
  it("minifies unless --no-minify is passed", () => {
    expect(resolveMinify([])).toBe(true);
    expect(resolveMinify(["--browser", "chrome"])).toBe(true);
    expect(resolveMinify(["--browser", "chrome", "--no-minify"])).toBe(false);
  });

  it("minifies every bundle by default, including whitespace in the ES module bundles", () => {
    const configs = createViteConfigs("dist/test");

    expect(configs).toHaveLength(4);
    for (const config of configs) {
      const lib = config.build?.lib;
      const formats = lib ? lib.formats : undefined;

      expect(config.build?.minify).toBe(true);
      expect(config.build?.sourcemap).toBe(false);
      if (formats?.includes("es")) {
        expect(config.build?.rolldownOptions?.output).toEqual({ minify: true });
      }
    }
  });

  it("leaves every bundle unminified for a debug build", () => {
    for (const config of createViteConfigs("dist/test", false)) {
      expect(config.build?.minify).toBe(false);
      expect(config.build?.rolldownOptions?.output).toBeUndefined();
    }
  });
});

describe("browser manifests", () => {
  const manifestTemplate: ManifestTemplate = {
    manifest_version: 3,
    name: "Media Hotkeys",
    description: "test",
  };
  const packageJson = { name: "media-hotkeys", version: "1.2.3" };

  it("gives Firefox a minimum version and a data collection declaration", () => {
    const manifest = createManifest({ browser: "firefox", packageJson, manifestTemplate });

    expect(manifest.version).toBe("1.2.3");
    expect(manifest.browser_specific_settings?.gecko).toMatchObject({
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] },
    });
  });

  it("leaves Gecko settings out of Chromium manifests", () => {
    const manifest = createManifest({ browser: "chrome", packageJson, manifestTemplate });

    expect(manifest.browser_specific_settings).toBeUndefined();
  });
});
