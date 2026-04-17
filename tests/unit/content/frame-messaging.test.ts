import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVideo, resetContentTestState } from "./helpers.js";
import { delegateActionToChildFrames, setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

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
});
