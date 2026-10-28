import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMappedKey, makeVideo, mockRect, rect, resetContentTestState } from "./helpers.js";
import { delegateActionToChildFrames, setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

function setWindowParentForTest(parentWindow: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parentWindow,
  });
}

function restoreTopWindowForTest(): void {
  setWindowParentForTest(window);
}

describe("frame action delegation", () => {
  it("returns false when no child iframes exist", async () => {
    await expect(delegateActionToChildFrames("toggleMute")).resolves.toBe(false);
  });

  it("resolves true when a child frame reports handling the action", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    expect(frameWindow).toBeTruthy();

    vi.spyOn(frameWindow!, "postMessage").mockImplementation((message: unknown) => {
      const request = message as {
        requestId: string;
        type: string;
      };

      if (request.type !== "MEDIA_SHORTCUTS_HANDLE_ACTION") {
        return;
      }

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_SHORTCUTS_ACTION_RESULT",
            requestId: request.requestId,
            handled: true,
          },
          source: frameWindow!,
        }),
      );
    });

    await expect(delegateActionToChildFrames("toggleMute")).resolves.toBe(true);
  });

  it("resolves false when the frame responds with handled=false", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow!;

    let capturedRequestId = "";
    vi.spyOn(frameWindow, "postMessage").mockImplementation((message: unknown) => {
      capturedRequestId = (message as { requestId: string }).requestId;
    });

    const delegatePromise = delegateActionToChildFrames("toggleMute");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_ACTION_RESULT",
          requestId: capturedRequestId,
          handled: false,
        },
        source: frameWindow,
      }),
    );

    await expect(delegatePromise).resolves.toBe(false);
  });

  it("resolves false when postMessage throws for all frames", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow!;

    vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {
      throw new Error("cross-origin frame");
    });

    await expect(delegateActionToChildFrames("toggleMute")).resolves.toBe(false);
  });
});

describe("frame message handling", () => {
  it("ignores messages with a null source", () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
          action: "togglePlayPause",
          requestId: "test-null-src",
        },
        source: null,
      }),
    );
  });

  it("ignores messages that are not from the extension", () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "unrelated-message" },
        source: window,
      }),
    );
  });

  it("handles an incoming action request from a child frame and sends a response", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    setSettingsForTests(settings);

    const mockSource = { postMessage: vi.fn() } as unknown as Window;
    const requestId = "frame-req-1";

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
          action: "togglePlayPause",
          requestId,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, handled: true }),
      "*",
    );
  });

  it("ignores site policy messages in the top frame", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const mockSource = { postMessage: vi.fn() } as unknown as Window;
    const requestId = "frame-req-top-policy";

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_HOTKEYS_SITE_POLICY",
          disabled: true,
        },
        source: mockSource,
      }),
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
          action: "togglePlayPause",
          requestId,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, handled: true }),
      "*",
    );
  });

  it("accepts site policy messages from the parent frame", async () => {
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);

    try {
      const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      const requestId = "frame-req-parent-policy";

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_HOTKEYS_SITE_POLICY",
            disabled: true,
          },
          source: parentSource,
        }),
      );

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
            action: "togglePlayPause",
            requestId,
          },
          source: parentSource,
        }),
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(playSpy).not.toHaveBeenCalled();
      expect(parentSource.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId, handled: false }),
        "*",
      );
    } finally {
      restoreTopWindowForTest();
    }
  });

  it("ignores site policy messages from non-parent frames", async () => {
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    const otherSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);

    try {
      const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      const requestId = "frame-req-non-parent-policy";

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_HOTKEYS_SITE_POLICY",
            disabled: true,
          },
          source: otherSource,
        }),
      );

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
            action: "togglePlayPause",
            requestId,
          },
          source: otherSource,
        }),
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(playSpy).toHaveBeenCalled();
      expect(otherSource.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId, handled: true }),
        "*",
      );
    } finally {
      restoreTopWindowForTest();
    }
  });

  it("forwards disabled top-level policy to child frames by default", () => {
    window.history.pushState({}, "", "/watch");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow!;
    const postMessageSpy = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => undefined);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["localhost"];
    setSettingsForTests(settings);

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MEDIA_HOTKEYS_SITE_POLICY",
        disabled: true,
      }),
      "*",
    );
  });

  it("tells child frames when an in-place navigation changes the policy", async () => {
    window.history.pushState({}, "", "/watch");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow!;
    const postMessageSpy = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => undefined);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    setSettingsForTests(settings);
    postMessageSpy.mockClear();

    // A single-page app navigates and swaps its content.
    window.history.pushState({}, "", "/shorts/clip");
    document.body.appendChild(document.createElement("main"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MEDIA_HOTKEYS_SITE_POLICY", disabled: true }),
      "*",
    );
  });

  it("lets child frames ignore disabled top-level policy when the matching rule says to ignore embeds", () => {
    window.history.pushState({}, "", "/watch");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow!;
    const postMessageSpy = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => undefined);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost", policy: "disabled", embedsPolicy: "ignore" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["localhost"];
    setSettingsForTests(settings);

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MEDIA_HOTKEYS_SITE_POLICY",
        disabled: false,
      }),
      "*",
    );
  });

  it("responds to a score request with null when no media exists", async () => {
    const mockSource = { postMessage: vi.fn() } as unknown as Window;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_SCORE_REQUEST",
          requestId: "score-req-empty",
          budgetMs: 0,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MEDIA_SHORTCUTS_SCORE_RESPONSE",
        requestId: "score-req-empty",
        bestScore: null,
      }),
      "*",
    );
  });

  it("responds to a score request with the best local candidate score", async () => {
    makeVideo();
    const mockSource = { postMessage: vi.fn() } as unknown as Window;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_SCORE_REQUEST",
          requestId: "score-req-media",
          budgetMs: 0,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MEDIA_SHORTCUTS_SCORE_RESPONSE",
        requestId: "score-req-media",
        bestScore: expect.any(Number),
        areaScore: expect.any(Number),
      }),
      "*",
    );
  });

  it("executes an action routed under a previously scored requestId", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const mockSource = { postMessage: vi.fn() } as unknown as Window;
    const requestId = "score-then-execute";

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_SCORE_REQUEST",
          requestId,
          budgetMs: 0,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
          action: "togglePlayPause",
          requestId,
        },
        source: mockSource,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, handled: true }),
      "*",
    );
  });

  it("does not apply URL-matched site policies directly inside embedded frames", async () => {
    window.history.pushState({}, "", "/embed/1");
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);

    try {
      const settings = structuredClone(DEFAULT_SETTINGS);
      settings.siteSettings.sitePolicies = [
        { pattern: "localhost", policy: "disabled", embedsPolicy: "inherit" },
      ];
      settings.siteSettings.disabledUrlPatterns = ["localhost"];
      setSettingsForTests(settings);

      const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      const requestId = "frame-req-embed-opt-out";

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "media-shortcuts-extension",
            type: "MEDIA_SHORTCUTS_HANDLE_ACTION",
            action: "togglePlayPause",
            requestId,
          },
          source: parentSource,
        }),
      );

      await Promise.resolve();
      await Promise.resolve();

      expect(playSpy).toHaveBeenCalled();
      expect(parentSource.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId, handled: true }),
        "*",
      );
    } finally {
      restoreTopWindowForTest();
    }
  });
});

describe("cross-frame area scaling", () => {
  /**
   * Adds an iframe whose (simulated) content script reports a media score
   * made almost entirely of visible area in its own viewport, and records
   * whether the parent routes the action to it.
   */
  function makeScoringChildFrame(
    frameRect: DOMRect,
    // A paused video filling the iframe: base 10 + full area 200.
    { bestScore = 210, areaScore = 200 } = {},
  ): { childWindow: Window; executeRequests: unknown[] } {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    mockRect(iframe, frameRect);
    const childWindow = iframe.contentWindow as Window;
    const executeRequests: unknown[] = [];

    vi.spyOn(childWindow, "postMessage").mockImplementation((message: unknown) => {
      const request = message as { type: string; requestId: string };
      if (request.type === "MEDIA_SHORTCUTS_SCORE_REQUEST") {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: childWindow,
            data: {
              source: "media-shortcuts-extension",
              type: "MEDIA_SHORTCUTS_SCORE_RESPONSE",
              requestId: request.requestId,
              bestScore,
              areaScore,
            },
          }),
        );
      } else if (request.type === "MEDIA_SHORTCUTS_HANDLE_ACTION") {
        executeRequests.push(request);
      }
    });

    return { childWindow, executeRequests };
  }

  async function flushArbitration(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it("scales a child frame's area score by how much of the viewport the iframe covers", async () => {
    // Local paused video covering a quarter of the viewport: 10 + 50 = 60.
    const localVideo = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(localVideo, rect(0, 0, 512, 384));
    const playSpy = vi.spyOn(localVideo, "play").mockResolvedValue(undefined);
    // A 300x250 ad-sized iframe covers ~10% of the 1024x768 viewport, so its
    // full-frame video is worth ~10 + 19, not 210.
    const child = makeScoringChildFrame(rect(600, 400, 300, 250));

    await dispatchMappedKey("k");
    await flushArbitration();

    expect(playSpy).toHaveBeenCalledOnce();
    expect(child.executeRequests).toHaveLength(0);
  });

  it("routes to a child frame whose iframe dominates the viewport", async () => {
    const localVideo = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(localVideo, rect(0, 0, 512, 384));
    const playSpy = vi.spyOn(localVideo, "play").mockResolvedValue(undefined);
    const child = makeScoringChildFrame(rect(0, 0, 1024, 768));

    await dispatchMappedKey("k");
    await flushArbitration();

    expect(child.executeRequests).toHaveLength(1);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not route to a child frame whose iframe is hidden", async () => {
    const localVideo = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(localVideo, rect(0, 0, 512, 384));
    const playSpy = vi.spyOn(localVideo, "play").mockResolvedValue(undefined);
    // A lightbox player preloaded in a 0x0 iframe, with no area to rescale.
    const child = makeScoringChildFrame(rect(512, 384, 0, 0), { bestScore: 240, areaScore: 0 });

    await dispatchMappedKey("k");
    await flushArbitration();

    expect(playSpy).toHaveBeenCalledOnce();
    expect(child.executeRequests).toHaveLength(0);
  });

  it("drops a child frame whose rescaled score is no longer above zero", async () => {
    // A muted video filling a tiny iframe scores 150 + 200 - 250 in its own
    // frame, but its area is worth almost nothing in this viewport.
    const child = makeScoringChildFrame(rect(0, 0, 100, 50), { bestScore: 100, areaScore: 200 });
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child.childWindow,
        data: {
          source: "media-shortcuts-extension",
          type: "MEDIA_HOTKEYS_MEDIA_PRESENCE",
          hasMedia: true,
        },
      }),
    );

    await dispatchMappedKey("ArrowDown");
    await flushArbitration();

    // Only the last-resort placeholder broadcast may reach it.
    expect(
      child.executeRequests.filter(
        (request) => !(request as { allowPlaceholder?: boolean }).allowPlaceholder,
      ),
    ).toHaveLength(0);
  });
});
