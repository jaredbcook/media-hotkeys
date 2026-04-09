import { describe, expect, it } from "vitest";
import { getOverlayElement, makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS, type AdvancedSettings } from "../../../src/storage.js";

const advancedSettings: AdvancedSettings = DEFAULT_ADVANCED_SETTINGS;

function setViewportSize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

describe("overlay layout", () => {
  it("sizes overlay icons to 10% of media width and clamps them to min and max sizes", () => {
    const mediumVideo = makeVideo(500);
    showActionOverlay("togglePlayPause", mediumVideo, "center", advancedSettings);
    let icon = document.querySelector("#media-shortcuts-overlay svg") as SVGElement;
    expect(icon.style.width).toBe("50px");
    expect(icon.style.height).toBe("50px");

    const smallVideo = makeVideo(200);
    showActionOverlay("togglePlayPause", smallVideo, "center", advancedSettings);
    icon = document.querySelector("#media-shortcuts-overlay svg") as SVGElement;
    expect(icon.style.width).toBe("32px");
    expect(icon.style.height).toBe("32px");

    const largeVideo = makeVideo(800);
    showActionOverlay("togglePlayPause", largeVideo, "center", advancedSettings);
    icon = document.querySelector("#media-shortcuts-overlay svg") as SVGElement;
    expect(icon.style.width).toBe("80px");
    expect(icon.style.height).toBe("80px");
  });

  it("sizes overlay text to 2.5% of media width and clamps it to min and max sizes", () => {
    const mediumVideo = makeVideo(800);
    showActionOverlay("toggleMute", mediumVideo, "center", advancedSettings);
    expect(getOverlayElement()?.style.fontSize).toBe("20px");

    const smallVideo = makeVideo(200);
    showActionOverlay("toggleMute", smallVideo, "center", advancedSettings);
    expect(getOverlayElement()?.style.fontSize).toBe("16px");

    const largeVideo = makeVideo(1200);
    showActionOverlay("toggleMute", largeVideo, "center", advancedSettings);
    expect(getOverlayElement()?.style.fontSize).toBe("24px");
  });

  it("positions the overlay centered over the media element", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "center", advancedSettings);
    const overlay = getOverlayElement()!;
    expect(overlay.style.transform).toBe("translate(-50%, -50%)");
    expect(overlay.style.left).toBe("420px");
    expect(overlay.style.top).toBe("280px");
  });

  it("positions the overlay at top-left with inset", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "top-left", advancedSettings);
    const overlay = getOverlayElement()!;
    expect(overlay.style.transform).toBe("translate(0%, 0%)");
    expect(overlay.style.left).toBe("116px");
    expect(overlay.style.top).toBe("116px");
  });

  it("positions the overlay at center-right with inset", () => {
    const video = makeVideo();
    showActionOverlay("seekForwardSmall", video, "center-right", advancedSettings);
    const overlay = getOverlayElement()!;
    expect(overlay.style.transform).toBe("translate(-100%, -50%)");
    expect(overlay.style.left).toBe("724px");
    expect(overlay.style.top).toBe("280px");
  });

  it("positions the overlay at bottom with inset", () => {
    const video = makeVideo();
    showActionOverlay("togglePlayPause", video, "bottom", advancedSettings);
    const overlay = getOverlayElement()!;
    expect(overlay.style.transform).toBe("translate(-50%, -100%)");
    expect(overlay.style.left).toBe("420px");
    expect(overlay.style.top).toBe("444px");
  });

  it("falls back to the viewport center when the media is display:none", () => {
    setViewportSize(1280, 720);
    const video = makeVideo({ display: "none", width: 0, height: 0, left: 0, top: 0 });

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);

    const overlay = getOverlayElement()!;
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.transform).toBe("translate(-50%, -50%)");
    expect(overlay.style.left).toBe("640px");
    expect(overlay.style.top).toBe("360px");
  });

  it("falls back to the viewport center when the media rect is zero-sized", () => {
    setViewportSize(1200, 800);
    const video = makeVideo({ width: 0, height: 0, left: 0, top: 0 });

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);

    const overlay = getOverlayElement()!;
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.left).toBe("600px");
    expect(overlay.style.top).toBe("400px");
  });

  it("falls back to the viewport when the media rect is fully off-screen", () => {
    setViewportSize(1024, 768);
    const video = makeVideo({ left: -800, top: 100, width: 640, height: 360 });

    showActionOverlay("togglePlayPause", video, "bottom", advancedSettings);

    const overlay = getOverlayElement()!;
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.transform).toBe("translate(-50%, -100%)");
    expect(overlay.style.left).toBe("512px");
    expect(overlay.style.top).toBe("752px");
  });

  it("uses viewport positions with insets for hidden media fallbacks", () => {
    setViewportSize(360, 240);
    const video = makeVideo({ hidden: true, width: 0, height: 0, left: 0, top: 0 });

    showActionOverlay("togglePlayPause", video, "top-left", advancedSettings);

    const overlay = getOverlayElement()!;
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.transform).toBe("translate(0%, 0%)");
    expect(overlay.style.left).toBe("16px");
    expect(overlay.style.top).toBe("16px");
  });

  it("mounts the overlay inside the fullscreen host when the media is fullscreen", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const video = makeVideo();
    host.appendChild(video);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => host,
    });

    showActionOverlay("togglePlayPause", video, "center", advancedSettings);

    const overlay = getOverlayElement()!;
    expect(overlay.parentElement).toBe(host);
    expect(overlay.style.position).toBe("fixed");
    expect(overlay.style.lineHeight).toBe("1.2");
  });
});
