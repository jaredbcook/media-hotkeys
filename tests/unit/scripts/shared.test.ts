import { describe, expect, it } from "vitest";
import { assertBrowser, resolveBrowsers, supportedBrowsers } from "../../../scripts/shared.js";

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
