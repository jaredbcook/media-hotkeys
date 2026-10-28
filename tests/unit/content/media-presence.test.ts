import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, mockRect, rect, resetContentTestState } from "./helpers.js";
import { setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

const PRESENCE_TYPE = "MEDIA_HOTKEYS_MEDIA_PRESENCE";
const PRESENCE_REQUEST_TYPE = "MEDIA_HOTKEYS_MEDIA_PRESENCE_REQUEST";

beforeEach(() => {
  resetContentTestState();
});

// Unlike dispatchMappedKey, the event is cancelable and starts at the body, so
// both preventDefault and page listeners behind the extension are observable.
function pressKey(key: string): { event: KeyboardEvent; reachedPage: boolean } {
  let reachedPage = false;
  const pageListener = (): void => {
    reachedPage = true;
  };
  document.body.addEventListener("keydown", pageListener);
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  document.body.removeEventListener("keydown", pageListener);
  return { event, reachedPage };
}

// Visible, but too small to hold a click-to-play placeholder.
function addChildFrame(frameRect = rect(0, 0, 80, 40)): {
  childWindow: Window;
  posted: { type: string }[];
} {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  mockRect(iframe, frameRect);
  const childWindow = iframe.contentWindow as Window;
  const posted: { type: string }[] = [];
  vi.spyOn(childWindow, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as { type: string });
  });
  return { childWindow, posted };
}

function reportFromChild(childWindow: Window, hasMedia: boolean): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: childWindow,
      data: { source: "media-shortcuts-extension", type: PRESENCE_TYPE, hasMedia },
    }),
  );
}

function makePlaceholder(): HTMLDivElement {
  const placeholder = document.createElement("div");
  placeholder.style.backgroundImage = 'url("https://example.com/thumb.png")';
  placeholder.style.cursor = "pointer";
  placeholder.textContent = "6:37";
  const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  placeholder.appendChild(playIcon);
  document.body.appendChild(placeholder);
  mockRect(placeholder, rect(0, 0, 320, 180));
  mockRect(playIcon, rect(128, 67, 64, 46));
  return placeholder;
}

describe("keys on pages without media", () => {
  it.each(["ArrowRight", "ArrowDown", "j", "k", "m", "o"])(
    "leaves %s to the page when no media exists",
    (key) => {
      const { event, reachedPage } = pressKey(key);

      expect(event.defaultPrevented).toBe(false);
      expect(reachedPage).toBe(true);
    },
  );

  it("leaves keys to the page when only an idle background loop exists", () => {
    makeVideo({ muted: true, paused: true } as Partial<HTMLVideoElement>);

    const { event, reachedPage } = pressKey("ArrowRight");

    expect(event.defaultPrevented).toBe(false);
    expect(reachedPage).toBe(true);
  });

  it("takes mapped keys from the page when media exists", () => {
    makeVideo({ paused: true } as Partial<HTMLVideoElement>);

    const { event, reachedPage } = pressKey("ArrowRight");

    expect(event.defaultPrevented).toBe(true);
    expect(reachedPage).toBe(false);
  });

  it("leaves unmapped keys alone when media exists", () => {
    makeVideo({ paused: true } as Partial<HTMLVideoElement>);

    const { event, reachedPage } = pressKey("q");

    expect(event.defaultPrevented).toBe(false);
    expect(reachedPage).toBe(true);
  });

  it("takes the play key, and only the play key, for a click-to-play placeholder", () => {
    makePlaceholder();

    expect(pressKey("k").event.defaultPrevented).toBe(true);
    expect(pressKey("ArrowRight").event.defaultPrevented).toBe(false);
  });
});

describe("vertical scroll keys", () => {
  function setScrollSize(element: Element, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
  }

  function makePageScrollable(): void {
    // jsdom has no layout, so give the viewport something to scroll.
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: document.documentElement,
    });
    setScrollSize(document.documentElement, 4000, 768);
  }

  function pressKeyAt(target: Element, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  function interactWith(media: HTMLMediaElement): void {
    media.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
  }

  afterEach(() => {
    delete (document as { scrollingElement?: Element }).scrollingElement;
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    delete (document.documentElement as { clientHeight?: number }).clientHeight;
  });

  it("leaves them to a scrollable page next to an idle video, but takes other keys", () => {
    makePageScrollable();
    mockRect(makeVideo({ paused: true } as Partial<HTMLVideoElement>), rect(0, 0, 640, 360));

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(false);
    expect(pressKey("ArrowUp").event.defaultPrevented).toBe(false);
    expect(pressKey("ArrowRight").event.defaultPrevented).toBe(true);
    expect(pressKey("j").event.defaultPrevented).toBe(true);
  });

  it("takes them when the page cannot scroll", () => {
    mockRect(makeVideo({ paused: true } as Partial<HTMLVideoElement>), rect(0, 0, 640, 360));

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(true);
  });

  it("takes them on a scrollable page once the user interacted with a visible video", () => {
    makePageScrollable();
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(video, rect(0, 0, 640, 360));
    interactWith(video);

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(true);
  });

  it("takes them for a visible video playing with sound", () => {
    makePageScrollable();
    const video = makeVideo({
      paused: false,
      readyState: 4,
      muted: false,
      volume: 1,
    } as Partial<HTMLVideoElement>);
    mockRect(video, rect(0, 0, 640, 360));

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(true);
  });

  it("gives them back to the page once the video scrolls out of view", () => {
    makePageScrollable();
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(video, rect(0, 0, 640, 360));
    interactWith(video);
    mockRect(video, rect(0, -2000, 640, 360));

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(false);
  });

  it("leaves them to a scroll container around the focused element", () => {
    mockRect(makeVideo({ paused: true } as Partial<HTMLVideoElement>), rect(0, 0, 640, 360));
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    setScrollSize(container, 2000, 300);
    const item = document.createElement("button");
    container.appendChild(item);
    document.body.appendChild(container);

    expect(pressKeyAt(item, "ArrowDown").defaultPrevented).toBe(false);
    expect(pressKeyAt(document.body, "ArrowDown").defaultPrevented).toBe(true);
  });

  it("takes them when a scroll lock hides the page's overflow", () => {
    makePageScrollable();
    document.body.style.overflowY = "hidden";
    mockRect(makeVideo({ paused: true } as Partial<HTMLVideoElement>), rect(0, 0, 640, 360));

    expect(pressKey("ArrowDown").event.defaultPrevented).toBe(true);
    document.body.style.overflowY = "";
  });
});

describe("keys on pages whose media may be in child frames", () => {
  it("leaves keys to the page and skips arbitration when no child frame reported media", () => {
    const child = addChildFrame();

    const { event, reachedPage } = pressKey("ArrowRight");

    expect(event.defaultPrevented).toBe(false);
    expect(reachedPage).toBe(true);
    expect(child.posted.map((message) => message.type)).not.toContain(
      "MEDIA_SHORTCUTS_SCORE_REQUEST",
    );
  });

  it("takes keys once a child frame reports media, and arbitrates with it", () => {
    const child = addChildFrame();
    reportFromChild(child.childWindow, true);

    const { event, reachedPage } = pressKey("ArrowRight");

    expect(event.defaultPrevented).toBe(true);
    expect(reachedPage).toBe(false);
    expect(child.posted.map((message) => message.type)).toContain("MEDIA_SHORTCUTS_SCORE_REQUEST");
  });

  it("leaves keys to the page when the frame reporting media is hidden", () => {
    // A lightbox player preloaded in a 0x0 iframe.
    const child = addChildFrame(rect(512, 384, 0, 0));
    reportFromChild(child.childWindow, true);

    const { event, reachedPage } = pressKey("ArrowRight");

    expect(event.defaultPrevented).toBe(false);
    expect(reachedPage).toBe(true);
  });

  it("leaves keys to the page again after the child frame reports its media is gone", () => {
    const child = addChildFrame();
    reportFromChild(child.childWindow, true);
    reportFromChild(child.childWindow, false);

    expect(pressKey("ArrowRight").event.defaultPrevented).toBe(false);
  });

  it("forgets a child frame's report when its iframe is removed", () => {
    const child = addChildFrame();
    reportFromChild(child.childWindow, true);
    document.querySelector("iframe")?.remove();

    expect(pressKey("ArrowRight").event.defaultPrevented).toBe(false);
  });

  it("sends the site policy to a child frame that starts after the page loaded", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost", policy: "disabled", embedsPolicy: "inherit" },
    ];
    setSettingsForTests(settings);
    const child = addChildFrame();

    // The child's content script reports its presence once it is running.
    reportFromChild(child.childWindow, false);

    expect(child.posted).toContainEqual(
      expect.objectContaining({ type: "MEDIA_HOTKEYS_SITE_POLICY", disabled: true }),
    );
  });

  it("takes the play key for a player-sized iframe that may hold a click-to-play embed", () => {
    addChildFrame(rect(0, 0, 640, 360));

    expect(pressKey("k").event.defaultPrevented).toBe(true);
    expect(pressKey("ArrowRight").event.defaultPrevented).toBe(false);
  });
});

describe("reporting media presence to the parent frame", () => {
  let parentWindow: Window & { postMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    parentWindow = { postMessage: vi.fn() } as unknown as typeof parentWindow;
    Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", { configurable: true, value: window });
  });

  function presenceReports(): boolean[] {
    return parentWindow.postMessage.mock.calls
      .map(([message]) => message as { type: string; hasMedia: boolean })
      .filter((message) => message.type === PRESENCE_TYPE)
      .map((message) => message.hasMedia);
  }

  async function waitForReport(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  it("reports when media appears and when it goes away", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    await waitForReport();
    expect(presenceReports()).toEqual([true]);

    video.remove();
    await waitForReport();
    expect(presenceReports()).toEqual([true, false]);
  });

  it("does not count background loops as media", async () => {
    makeVideo({ muted: true, paused: true } as Partial<HTMLVideoElement>);
    document.body.appendChild(document.createElement("div"));
    await waitForReport();

    expect(presenceReports()).not.toContain(true);
  });

  it("includes media reported by its own child frames", async () => {
    const child = addChildFrame();
    reportFromChild(child.childWindow, true);
    await waitForReport();

    expect(presenceReports()).toEqual([true]);
  });

  it("answers the parent's request with its current state", () => {
    makeVideo({ paused: true } as Partial<HTMLVideoElement>);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow,
        data: { source: "media-shortcuts-extension", type: PRESENCE_REQUEST_TYPE },
      }),
    );

    expect(presenceReports()).toEqual([true]);
  });
});
