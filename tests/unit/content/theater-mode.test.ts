import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMappedKey, makeVideo, mockRect, rect, resetContentTestState } from "./helpers.js";
import { getTargetMedia, handleAction } from "../../../src/content.js";
import { exitTheater, getTheaterMedia } from "../../../src/content/theater.js";

// jsdom has no Popover API, so model the open/closed state the way browsers do:
// showPopover() requires a popover attribute and a connected element, and
// removing the element from the document closes it.
const openPopovers = new WeakSet<Element>();
const originalMatches = Element.prototype.matches;

function installPopoverStub(): void {
  Object.defineProperty(HTMLElement.prototype, "showPopover", {
    configurable: true,
    value(this: HTMLElement) {
      if (!this.hasAttribute("popover") || !this.isConnected || openPopovers.has(this)) {
        throw new DOMException("Invalid state", "InvalidStateError");
      }
      openPopovers.add(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", {
    configurable: true,
    value(this: HTMLElement) {
      openPopovers.delete(this);
    },
  });
  Element.prototype.matches = function (this: Element, selectors: string): boolean {
    if (selectors === ":popover-open") {
      return openPopovers.has(this) && this.isConnected;
    }
    return originalMatches.call(this, selectors);
  };
}

function removePopoverStub(): void {
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
  Element.prototype.matches = originalMatches;
}

let scrollToSpy: MockInstance<typeof window.scrollTo>;

beforeEach(() => {
  resetContentTestState();
  installPopoverStub();
  scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  exitTheater({ restoreScroll: false });
  removePopoverStub();
});

describe("theater mode", () => {
  it("promotes the video to the top layer in place and restores it on toggle", () => {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const video = makeVideo();
    wrapper.appendChild(video);

    handleAction("toggleTheater", video);

    expect(getTheaterMedia()).toBe(video);
    expect(video.parentElement).toBe(wrapper);
    expect(video.getAttribute("popover")).toBe("manual");
    expect(video.getAttribute("data-media-hotkeys-theater")).toBe("true");
    expect(video.controls).toBe(true);
    expect(document.head.querySelector("style[data-media-hotkeys-theater-style]")).not.toBeNull();

    handleAction("toggleTheater", video);

    expect(getTheaterMedia()).toBeNull();
    expect(video.parentElement).toBe(wrapper);
    expect(video.hasAttribute("popover")).toBe(false);
    expect(video.hasAttribute("data-media-hotkeys-theater")).toBe(false);
    expect(video.controls).toBe(false);
  });

  it("restores the page scroll position on exit", () => {
    const video = makeVideo();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    handleAction("toggleTheater", video);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });

    exitTheater();

    expect(scrollToSpy).toHaveBeenCalledWith(0, 640);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("keeps site-provided controls and popover attributes intact on exit", () => {
    const video = makeVideo();
    video.controls = true;
    video.setAttribute("popover", "hint");

    handleAction("toggleTheater", video);
    exitTheater();

    expect(video.controls).toBe(true);
    expect(video.getAttribute("popover")).toBe("hint");
  });

  it("exits on Escape and swallows the key", async () => {
    const video = makeVideo();
    const pageListener = vi.fn();
    window.addEventListener("keydown", pageListener);
    handleAction("toggleTheater", video);

    await dispatchMappedKey("Escape");

    expect(getTheaterMedia()).toBeNull();
    expect(pageListener).not.toHaveBeenCalled();
    window.removeEventListener("keydown", pageListener);
  });

  it("lets Escape through when theater mode is not active", async () => {
    makeVideo();
    const pageListener = vi.fn();
    window.addEventListener("keydown", pageListener);

    await dispatchMappedKey("Escape");

    expect(pageListener).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", pageListener);
  });

  it("toggles theater mode with the default t binding", async () => {
    const video = makeVideo({ paused: false, readyState: 4 } as Partial<HTMLVideoElement>);

    await dispatchMappedKey("t");
    expect(getTheaterMedia()).toBe(video);

    await dispatchMappedKey("t");
    expect(getTheaterMedia()).toBeNull();
  });

  it("targets the theater video over other playing media", () => {
    makeVideo({ paused: false, readyState: 4 } as Partial<HTMLVideoElement>);
    const theaterVideo = makeVideo();

    handleAction("toggleTheater", theaterVideo);

    expect(getTargetMedia()).toBe(theaterVideo);
  });

  it("moves theater mode to a different video instead of stacking", () => {
    const first = makeVideo();
    const second = makeVideo();

    handleAction("toggleTheater", first);
    handleAction("toggleTheater", second);

    expect(getTheaterMedia()).toBe(second);
    expect(first.hasAttribute("popover")).toBe(false);
  });

  it("clears stale state when the page removes the video", () => {
    const video = makeVideo();
    handleAction("toggleTheater", video);

    video.remove();

    expect(getTheaterMedia()).toBeNull();
    expect(video.hasAttribute("popover")).toBe(false);
    expect(video.hasAttribute("data-media-hotkeys-theater")).toBe(false);
  });

  it("injects styles into the shadow root that owns the video", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/test.mp4");
    shadowRoot.appendChild(video);
    document.body.appendChild(host);

    handleAction("toggleTheater", video);

    expect(getTheaterMedia()).toBe(video);
    expect(shadowRoot.querySelector("style[data-media-hotkeys-theater-style]")).not.toBeNull();
  });

  it("does nothing when the Popover API is unavailable", () => {
    removePopoverStub();
    const video = makeVideo();

    handleAction("toggleTheater", video);

    expect(getTheaterMedia()).toBeNull();
    expect(video.hasAttribute("popover")).toBe(false);
    expect(video.controls).toBe(false);
  });

  it("leaves theater mode before entering fullscreen", () => {
    const video = makeVideo();
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    handleAction("toggleTheater", video);

    handleAction("toggleFullscreen", video);

    expect(getTheaterMedia()).toBeNull();
    expect(requestFullscreen).toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  });
});

describe("theater mode across frames", () => {
  type ChildFrame = {
    iframe: HTMLIFrameElement;
    childWindow: Window;
    executeRequests: { action: string; requestId: string }[];
    received: unknown[];
  };

  async function makeChildFrame({ entersTheater = true } = {}): Promise<ChildFrame> {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    mockRect(iframe, rect(0, 0, 1024, 768));
    const childWindow = iframe.contentWindow as Window;
    const executeRequests: ChildFrame["executeRequests"] = [];
    const received: unknown[] = [];
    // Let jsdom fire the initial about:blank load before any promotion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The child's content script reports its video, so the parent takes the key.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: childWindow,
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_HOTKEYS_MEDIA_PRESENCE",
          hasMedia: true,
        },
      }),
    );

    vi.spyOn(childWindow, "postMessage").mockImplementation((message: unknown) => {
      received.push(message);
      const request = message as { type: string; requestId: string; action: string };
      const reply = (data: Record<string, unknown>): void => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: childWindow,
            data: { source: "media-shortcuts-extension", ...data },
          }),
        );
      };

      if (request.type === "MEDIA_SHORTCUTS_SCORE_REQUEST") {
        reply({
          type: "MEDIA_SHORTCUTS_SCORE_RESPONSE",
          requestId: request.requestId,
          bestScore: 210,
          areaScore: 200,
        });
      } else if (request.type === "MEDIA_SHORTCUTS_HANDLE_ACTION") {
        executeRequests.push(request);
        if (entersTheater && request.action === "toggleTheater") {
          reply({ type: "MEDIA_HOTKEYS_THEATER", active: true, requestId: request.requestId });
        }
        reply({
          type: "MEDIA_SHORTCUTS_ACTION_RESULT",
          requestId: request.requestId,
          handled: true,
        });
      }
    });

    return { iframe, childWindow, executeRequests, received };
  }

  function postFromChild(child: ChildFrame, data: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child.childWindow,
        data: { source: "media-shortcuts-extension", type: "MEDIA_HOTKEYS_THEATER", ...data },
      }),
    );
  }

  async function flushArbitration(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function isPromoted(element: Element): boolean {
    return (
      element.getAttribute("data-media-hotkeys-theater") === "true" &&
      element.matches(":popover-open")
    );
  }

  it("enlarges the iframe a routed toggleTheater went to, and Esc unwinds both frames", async () => {
    const child = await makeChildFrame();

    await dispatchMappedKey("t");
    await flushArbitration();

    expect(child.executeRequests).toEqual([expect.objectContaining({ action: "toggleTheater" })]);
    expect(isPromoted(child.iframe)).toBe(true);

    await dispatchMappedKey("Escape");

    expect(isPromoted(child.iframe)).toBe(false);
    expect(child.received).toContainEqual(
      expect.objectContaining({ type: "MEDIA_HOTKEYS_THEATER", active: false }),
    );
  });

  it("ignores promotion requests from a frame it never routed toggleTheater to", async () => {
    const child = await makeChildFrame();

    postFromChild(child, { active: true, requestId: "forged" });
    postFromChild(child, { active: true });

    expect(isPromoted(child.iframe)).toBe(false);
  });

  it("enlarges an iframe without a grant while focus is inside it", async () => {
    const child = await makeChildFrame();
    child.iframe.focus();
    expect(document.activeElement).toBe(child.iframe);

    postFromChild(child, { active: true });

    expect(isPromoted(child.iframe)).toBe(true);
  });

  it("does not let an unfocused iframe borrow focus trust from a focused one", async () => {
    const focused = await makeChildFrame();
    const other = await makeChildFrame();
    focused.iframe.focus();

    postFromChild(other, { active: true });

    expect(isPromoted(other.iframe)).toBe(false);
  });

  it("follows focus into shadow roots when checking the focused iframe", async () => {
    const child = await makeChildFrame();
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).appendChild(child.iframe);
    document.body.appendChild(host);
    child.iframe.focus();

    postFromChild(child, { active: true });

    expect(isPromoted(child.iframe)).toBe(true);
  });

  it("does not let a sibling frame reuse another frame's grant", async () => {
    const winner = await makeChildFrame({ entersTheater: false });
    const sibling = await makeChildFrame({ entersTheater: false });
    // Make the sibling lose arbitration.
    mockRect(sibling.iframe, rect(0, 0, 10, 10));

    await dispatchMappedKey("t");
    await flushArbitration();
    const routed = winner.executeRequests[0] ?? sibling.executeRequests[0];
    const loser = routed === winner.executeRequests[0] ? sibling : winner;

    postFromChild(loser, { active: true, requestId: routed.requestId });

    expect(isPromoted(loser.iframe)).toBe(false);
  });

  it("shrinks the iframe when the promoted child reports that it exited", async () => {
    const child = await makeChildFrame();
    await dispatchMappedKey("t");
    await flushArbitration();
    expect(isPromoted(child.iframe)).toBe(true);

    postFromChild(child, { active: false });

    expect(isPromoted(child.iframe)).toBe(false);
  });

  it("asks the parent to enlarge this frame after a routed toggle, and exits on its order", async () => {
    const parentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
    try {
      const video = makeVideo();
      const send = (data: Record<string, unknown>): void => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: parentWindow,
            data: { source: "media-shortcuts-extension", ...data },
          }),
        );
      };

      send({ type: "MEDIA_SHORTCUTS_SCORE_REQUEST", requestId: "theater-req", budgetMs: 0 });
      await flushArbitration();
      send({
        type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
        action: "toggleTheater",
        requestId: "theater-req",
      });
      await flushArbitration();

      expect(getTheaterMedia()).toBe(video);
      expect(parentWindow.postMessage).toHaveBeenCalledWith(
        {
          source: "media-shortcuts-extension",
          type: "MEDIA_HOTKEYS_THEATER",
          active: true,
          requestId: "theater-req",
        },
        "*",
      );

      send({ type: "MEDIA_HOTKEYS_THEATER", active: false });

      expect(getTheaterMedia()).toBeNull();
      expect(parentWindow.postMessage).toHaveBeenCalledWith(
        { source: "media-shortcuts-extension", type: "MEDIA_HOTKEYS_THEATER", active: false },
        "*",
      );
    } finally {
      Object.defineProperty(window, "parent", { configurable: true, value: window });
    }
  });

  it("asks the parent to enlarge this frame after a keypress handled inside it", async () => {
    const parentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
    try {
      const video = makeVideo();
      video.tabIndex = 0;
      video.focus();

      await dispatchMappedKey("t");
      await flushArbitration();

      expect(getTheaterMedia()).toBe(video);
      expect(parentWindow.postMessage).toHaveBeenCalledWith(
        { source: "media-shortcuts-extension", type: "MEDIA_HOTKEYS_THEATER", active: true },
        "*",
      );
    } finally {
      Object.defineProperty(window, "parent", { configurable: true, value: window });
    }
  });
});
