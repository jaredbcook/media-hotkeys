import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS } from "../../../src/storage.js";

const OVERLAY_STYLE_SELECTOR = 'style[data-media-shortcuts-overlay="true"]';

let removedHead: HTMLHeadElement | null = null;

function removeHead(): void {
  removedHead = document.head;
  removedHead.remove();
}

beforeEach(() => {
  document.querySelectorAll(OVERLAY_STYLE_SELECTOR).forEach((style) => style.remove());
});

afterEach(() => {
  if (removedHead) {
    document.documentElement.prepend(removedHead);
    removedHead = null;
  }
});

describe("overlay styles", () => {
  it("leaves the document untouched until an overlay is shown", () => {
    expect(document.querySelector(OVERLAY_STYLE_SELECTOR)).toBeNull();
  });

  it("adds the styles on first use and only once", () => {
    const video = makeVideo();

    showActionOverlay("togglePlayPause", video, "center", DEFAULT_ADVANCED_SETTINGS);
    showActionOverlay("toggleMute", video, "center", DEFAULT_ADVANCED_SETTINGS);

    const styles = document.head.querySelectorAll(OVERLAY_STYLE_SELECTOR);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain("media-shortcuts-skip-slide");
  });

  it("shows the overlay in a document without a head", () => {
    removeHead();
    expect(document.head).toBeNull();
    const video = makeVideo();

    expect(() =>
      showActionOverlay("togglePlayPause", video, "center", DEFAULT_ADVANCED_SETTINGS),
    ).not.toThrow();

    expect(document.documentElement.querySelectorAll(OVERLAY_STYLE_SELECTOR)).toHaveLength(1);
  });
});
