// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createManifest } from "../../../scripts/build.js";
import {
  type ManifestTemplate,
  assertBrowser,
  resolveBrowsers,
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
