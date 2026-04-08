import { describe, expect, it } from "vitest";
import { assertBrowser, resolveBrowsers, supportedBrowsers } from "../scripts/shared.js";

describe("supportedBrowsers", () => {
  it("includes Edge as a supported browser target", () => {
    expect(supportedBrowsers).toEqual(["chrome", "edge", "firefox"]);
  });
});

describe("resolveBrowsers", () => {
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
});

describe("assertBrowser", () => {
  it("accepts Edge", () => {
    expect(assertBrowser("edge")).toBe("edge");
  });

  it("rejects unsupported browsers with the full target list", () => {
    expect(() => assertBrowser("safari")).toThrow(
      'Unsupported browser "safari". Expected one of: chrome, edge, firefox',
    );
  });
});
