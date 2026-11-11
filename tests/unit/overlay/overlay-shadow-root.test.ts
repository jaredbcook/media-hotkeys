import { afterEach, describe, expect, it } from "vitest";
import { getOverlayBox, getOverlayElement, getOverlayShadowRoot, makeVideo } from "./helpers.js";
import { showActionOverlay } from "../../../src/overlay.js";
import { DEFAULT_ADVANCED_SETTINGS } from "../../../src/storage.js";

const OVERLAY_ID = "media-hotkeys-overlay";

let removedHead: HTMLHeadElement | null = null;

afterEach(() => {
  if (removedHead) {
    document.documentElement.prepend(removedHead);
    removedHead = null;
  }
  Reflect.deleteProperty(document, "fullscreenElement");
});

function show(
  video: HTMLVideoElement,
  action: "togglePlayPause" | "toggleMute" = "togglePlayPause",
) {
  showActionOverlay(action, video, "center", DEFAULT_ADVANCED_SETTINGS);
}

describe("overlay shadow root", () => {
  it("leaves the document untouched until an overlay is shown", () => {
    expect(getOverlayElement()).toBeNull();
    expect(document.head.children).toHaveLength(0);
  });

  it("renders the contents in a closed shadow root and nothing in the page's own tree", () => {
    show(makeVideo());

    const host = getOverlayElement()!;
    expect(getOverlayShadowRoot()?.mode).toBe("closed");
    expect(host.shadowRoot).toBeNull();
    expect(host.childElementCount).toBe(0);
    expect(host.textContent).toBe("");
    expect(document.querySelector(`#${OVERLAY_ID} svg`)).toBeNull();
    expect(getOverlayBox()?.querySelector("svg")).not.toBeNull();
  });

  it("puts the overlay's look on the box inside the shadow root, not on the host", () => {
    show(makeVideo(), "toggleMute");

    const host = getOverlayElement()!;
    const box = getOverlayBox()!;
    expect(box.style.background).toBe("rgba(0, 0, 0, 0.6)");
    expect(box.style.padding).toBe("8px 16px");
    expect(box.style.display).toBe("flex");
    expect(host.style.background).not.toBe("rgba(0, 0, 0, 0.6)");
    expect(host.style.padding).not.toBe("8px 16px");
  });

  it("resets what the page sets on the host and keeps its own styles over page rules", () => {
    show(makeVideo());

    const host = getOverlayElement()!;
    // `all: initial` expands to longhands, so a page's `div { color: red }` and
    // the like can't be inherited into the shadow tree.
    expect(host.style.color).toBe("initial");
    expect(host.style.fontSize).toBe("initial");
    for (const property of [
      "position",
      "left",
      "top",
      "transform",
      "display",
      "opacity",
      "visibility",
      "z-index",
      "pointer-events",
    ]) {
      expect(host.style.getPropertyPriority(property), property).toBe("important");
    }
    expect(host.style.pointerEvents).toBe("none");
    expect(host.style.zIndex).toBe("2147483647");
  });

  it("keeps the skip animation's keyframes inside the shadow root, not the document", () => {
    const video = makeVideo();

    show(video);
    show(video, "toggleMute");

    const styles = getOverlayShadowRoot()!.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain("media-hotkeys-skip-slide");
    expect(document.head.children).toHaveLength(0);
    expect(document.querySelector("style")).toBeNull();
  });

  it("shows the overlay in a document without a head", () => {
    removedHead = document.head;
    removedHead.remove();
    expect(document.head).toBeNull();

    expect(() => show(makeVideo())).not.toThrow();

    expect(getOverlayBox()?.querySelector("svg")).not.toBeNull();
  });

  it("reuses the host and its shadow root across calls", () => {
    const video = makeVideo();

    show(video);
    const host = getOverlayElement();
    const box = getOverlayBox();
    show(video, "toggleMute");

    expect(getOverlayElement()).toBe(host);
    expect(getOverlayBox()).toBe(box);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`)).toHaveLength(1);
  });

  it("keeps the same shadow root when the host moves into a fullscreen element", () => {
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);
    const video = makeVideo();
    fullscreenHost.appendChild(video);

    show(video);
    const host = getOverlayElement();
    const box = getOverlayBox();
    expect(host?.parentElement).toBe(document.body);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenHost,
    });
    show(video, "toggleMute");

    expect(getOverlayElement()).toBe(host);
    expect(host?.parentElement).toBe(fullscreenHost);
    expect(getOverlayBox()).toBe(box);
    expect(box?.textContent).toContain("%");
  });

  it("builds a new overlay when the page removes the old one", () => {
    const video = makeVideo();
    show(video);
    const first = getOverlayElement();

    getOverlayElement()?.remove();
    show(video);

    expect(getOverlayElement()).not.toBe(first);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`)).toHaveLength(1);
    expect(getOverlayBox()?.querySelector("svg")).not.toBeNull();
  });

  it("replaces an overlay left behind by an earlier content script", () => {
    const orphan = document.createElement("div");
    orphan.id = OVERLAY_ID;
    orphan.setAttribute("data-media-hotkeys-overlay", "true");
    document.body.appendChild(orphan);

    show(makeVideo());

    expect(orphan.isConnected).toBe(false);
    expect(document.querySelectorAll(`#${OVERLAY_ID}`)).toHaveLength(1);
    expect(getOverlayBox()?.querySelector("svg")).not.toBeNull();
  });

  it("leaves a page element that happens to share the overlay's id alone", () => {
    const pageElement = document.createElement("div");
    pageElement.id = OVERLAY_ID;
    pageElement.innerHTML = "<p>the page's own content</p>";
    document.body.appendChild(pageElement);

    show(makeVideo());

    expect(pageElement.isConnected).toBe(true);
    expect(pageElement.textContent).toBe("the page's own content");
    expect(getOverlayElement()).not.toBe(pageElement);
    expect(getOverlayBox()?.querySelector("svg")).not.toBeNull();
  });
});
