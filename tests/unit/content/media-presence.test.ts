import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, mockRect, rect, resetContentTestState } from "./helpers.js";

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
