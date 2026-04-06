import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => {
  const store: Record<string, unknown> = {};
  return {
    default: {
      storage: {
        sync: {
          get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...store })),
          set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
        },
      },
    },
  };
});

import { delegateActionToChildFrames, getTargetMedia, handleAction } from "../src/content";

function makeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  const video = document.createElement("video");

  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(video, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  document.body.appendChild(video);
  return video;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("getTargetMedia", () => {
  it("returns null when no media is present", () => {
    expect(getTargetMedia()).toBeNull();
  });

  it("returns the first media element as fallback", () => {
    const video = makeVideo();
    expect(getTargetMedia()).toBe(video);
  });

  it("prefers a playing media element", () => {
    makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playing = makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
    } as Partial<HTMLVideoElement>);

    expect(getTargetMedia()).toBe(playing);
  });

  it("tracks media added after initialization", async () => {
    const initial = makeVideo();
    const addedLater = document.createElement("video");

    document.body.appendChild(addedLater);
    await Promise.resolve();
    addedLater.dispatchEvent(new Event("play"));

    expect(getTargetMedia()).toBe(addedLater);

    initial.remove();
    addedLater.remove();
  });

  it("tracks media added inside a shadow root after initialization", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });
    const shadowVideo = document.createElement("video");
    shadowRoot.appendChild(shadowVideo);

    await Promise.resolve();
    shadowVideo.dispatchEvent(new Event("play"));
    await Promise.resolve();

    expect(getTargetMedia()).toBe(shadowVideo);
  });
});

describe("handleAction", () => {
  it("toggles play/pause", () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    handleAction("togglePlayPause", video);

    expect(playSpy).toHaveBeenCalled();
  });

  it("swallows NotAllowedError when play is blocked", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const rejection = new DOMException("Playback blocked", "NotAllowedError");
    const playSpy = vi.spyOn(video, "play").mockRejectedValue(rejection);

    handleAction("togglePlayPause", video);
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
  });

  it("handles promise-like play results from another realm", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const thenSpy = vi.fn((resolve?: () => void, reject?: (error: DOMException) => void) => {
      reject?.(new DOMException("Playback blocked", "NotAllowedError"));
      resolve?.();
    });
    vi.spyOn(video, "play").mockReturnValue({
      then: thenSpy,
    } as unknown as Promise<void>);

    handleAction("togglePlayPause", video);
    await Promise.resolve();

    expect(thenSpy).toHaveBeenCalled();
  });

  it("swallows non-DOMException play rejections", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockRejectedValue({ name: "NotAllowedError" });

    handleAction("togglePlayPause", video);
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
  });

  it("toggles mute", () => {
    const video = makeVideo();
    video.muted = false;

    handleAction("toggleMute", video);
    expect(video.muted).toBe(true);

    handleAction("toggleMute", video);
    expect(video.muted).toBe(false);
  });

  it("adjusts volume up, clamped at 1", () => {
    const video = makeVideo();
    video.volume = 0.98;

    handleAction("volumeUp", video);
    expect(video.volume).toBeCloseTo(1.0);

    handleAction("volumeUp", video);
    expect(video.volume).toBe(1);
  });

  it("adjusts volume down, clamped at 0", () => {
    const video = makeVideo();
    video.volume = 0.02;

    handleAction("volumeDown", video);
    expect(video.volume).toBeCloseTo(0);

    handleAction("volumeDown", video);
    expect(video.volume).toBe(0);
  });

  it("seeks forward and backward using configured step sizes", () => {
    const video = makeVideo();
    video.currentTime = 10;

    handleAction("seekForwardSmall", video);
    expect(video.currentTime).toBe(15);

    handleAction("seekForwardMedium", video);
    expect(video.currentTime).toBe(25);

    handleAction("seekBackwardLarge", video);
    expect(video.currentTime).toBe(-5);
  });

  it("adjusts playback speed within configured bounds", () => {
    const video = makeVideo();
    video.playbackRate = 3.75;

    handleAction("speedUp", video);
    expect(video.playbackRate).toBeCloseTo(4.0);

    handleAction("speedUp", video);
    expect(video.playbackRate).toBe(4);

    video.playbackRate = 0.5;
    handleAction("slowDown", video);
    expect(video.playbackRate).toBeCloseTo(0.25);

    handleAction("slowDown", video);
    expect(video.playbackRate).toBe(0.25);
  });

  it("seeks to a percentage of duration", () => {
    const video = makeVideo({ duration: 100 } as Partial<HTMLVideoElement>);

    handleAction("seekToPercent50", video);

    expect(video.currentTime).toBe(50);
  });
});

describe("delegateActionToChildFrames", () => {
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

  it("handles an incoming action request from a child frame and sends response", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

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

    expect(playSpy).toHaveBeenCalled();
    expect(mockSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, handled: true }),
      "*",
    );
  });
});

describe("keyboard event handling", () => {
  it("performs action on a mapped key when media is present", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
  });

  it("does nothing for an unmapped key", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Q", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no media exists for a mapped key", async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();
  });

  it("skips action when active element is an input", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("skips action when active element is a textarea", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("skips action when active element is a select", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const select = document.createElement("select");
    document.body.appendChild(select);
    select.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("skips action when active element is contenteditable", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const div = document.createElement("div");
    document.body.appendChild(div);
    // jsdom does not implement isContentEditable — mock it directly
    Object.defineProperty(div, "isContentEditable", { get: () => true, configurable: true });
    vi.spyOn(document, "activeElement", "get").mockReturnValue(div);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("handles a shift+key for a mapped action (speedUp)", async () => {
    const video = makeVideo();
    video.playbackRate = 1.0;

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: ">", shiftKey: true, bubbles: true }),
    );
    await Promise.resolve();

    expect(video.playbackRate).toBeCloseTo(1.25);
  });

  it.each([
    ["meta", { metaKey: true }],
    ["alt", { altKey: true }],
    ["ctrl", { ctrlKey: true }],
  ] as const)("ignores mapped keys when the %s modifier is held", async (_modifier, eventInit) => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
      ...eventInit,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    document.dispatchEvent(event);
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
