import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchMappedKey,
  emitStorageChange,
  makeVideo,
  mockRect,
  rect,
  resetContentTestState,
  showActionOverlayMock,
  storageGetMock,
  storageSetMock as untypedStorageSetMock,
} from "./helpers.js";
import type { ExtensionSettings } from "../../../src/storage.js";

type ExecuteRequest = {
  type: string;
  requestId: string;
  action: string;
  overlaysEnabled?: boolean;
};
type ChildFrame = {
  childWindow: Window;
  executeRequests: ExecuteRequest[];
  otherRequests: unknown[];
  answerScoreRequests: () => void;
};

// The shared mock is declared without the argument `storage.sync.set` takes.
const storageSetMock = untypedStorageSetMock as unknown as Mock<
  (settings: Record<string, unknown>) => Promise<void>
>;

let storedSettings: Record<string, unknown>;

beforeEach(() => {
  resetContentTestState();
  // A storage area that keeps what is written, as `storage.sync` does.
  storedSettings = {};
  storageGetMock.mockImplementation(async () => structuredClone(storedSettings));
  storageSetMock.mockImplementation(async (settings: Record<string, unknown>) => {
    storedSettings = structuredClone(settings);
  });
});

afterEach(async () => {
  // Let this test's saves settle before the next test resets state.
  await flush();
  restoreTopWindowForTest();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function setWindowParentForTest(parentWindow: Window): void {
  Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });
}

function restoreTopWindowForTest(): void {
  setWindowParentForTest(window);
}

function savedShowOverlays(): boolean[] {
  return storageSetMock.mock.calls.map(
    ([settings]) => (settings as unknown as ExtensionSettings).advancedSettings.showOverlays,
  );
}

/**
 * Adds an iframe whose (simulated) content script reports the given score and
 * records what this frame sends it. With `holdScores`, score requests wait
 * until `answerScoreRequests` is called.
 */
function makeChildFrame(
  frameRect: DOMRect,
  { bestScore = 210, areaScore = 200, holdScores = false } = {},
): ChildFrame {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  mockRect(iframe, frameRect);
  const childWindow = iframe.contentWindow as Window;
  const executeRequests: ExecuteRequest[] = [];
  const otherRequests: unknown[] = [];
  const heldScoreRequestIds: string[] = [];

  const answerScoreRequest = (requestId: string): void => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: childWindow,
        data: {
          source: "media-hotkeys-extension",
          type: "MEDIA_HOTKEYS_SCORE_RESPONSE",
          requestId,
          bestScore,
          areaScore,
        },
      }),
    );
  };

  vi.spyOn(childWindow, "postMessage").mockImplementation((message: unknown) => {
    const request = message as ExecuteRequest;
    if (request.type === "MEDIA_HOTKEYS_SCORE_REQUEST") {
      if (holdScores) {
        heldScoreRequestIds.push(request.requestId);
      } else {
        answerScoreRequest(request.requestId);
      }
    } else if (request.type === "MEDIA_HOTKEYS_HANDLE_ACTION") {
      executeRequests.push(request);
      window.dispatchEvent(
        new MessageEvent("message", {
          source: childWindow,
          data: {
            source: "media-hotkeys-extension",
            type: "MEDIA_HOTKEYS_ACTION_RESULT",
            requestId: request.requestId,
            handled: true,
          },
        }),
      );
    } else if (!request.type.includes("MEDIA_PRESENCE") && !request.type.includes("SITE_POLICY")) {
      otherRequests.push(request);
    }
  });

  return {
    childWindow,
    executeRequests,
    otherRequests,
    answerScoreRequests: () => heldScoreRequestIds.splice(0).forEach(answerScoreRequest),
  };
}

function sendExecuteRequest(source: Window, data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        source: "media-hotkeys-extension",
        type: "MEDIA_HOTKEYS_HANDLE_ACTION",
        action: "toggleOverlays",
        ...data,
      },
      source,
    }),
  );
}

describe("overlay toggle in the frame that gets the key", () => {
  it("saves once and shows the new value when the media is local", async () => {
    const video = makeVideo();

    await dispatchMappedKey("o");
    await flush();

    expect(savedShowOverlays()).toEqual([false]);
    expect(showActionOverlayMock).toHaveBeenCalledOnce();
    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "toggleOverlays",
      video,
      "center",
      expect.anything(),
      { overlayEnabled: false },
    );
  });

  it("writes once however many frames the page has", async () => {
    // A small local video and three child frames, one filling the viewport.
    const localVideo = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(localVideo, rect(0, 0, 512, 384));
    const children = [
      makeChildFrame(rect(0, 0, 200, 150)),
      makeChildFrame(rect(0, 0, 1024, 768)),
      makeChildFrame(rect(300, 0, 200, 150)),
    ];

    await dispatchMappedKey("o");
    await flush();

    expect(storageSetMock).toHaveBeenCalledOnce();
    expect(savedShowOverlays()).toEqual([false]);
    // The confirmation goes to the one winning frame, with the new value, and
    // nothing is broadcast to the others.
    expect(children.map((child) => child.executeRequests.length)).toEqual([0, 1, 0]);
    expect(children[1].executeRequests[0]).toMatchObject({
      action: "toggleOverlays",
      overlaysEnabled: false,
    });
    expect(children.flatMap((child) => child.otherRequests)).toEqual([]);
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });

  it("saves each quick toggle once, in order, and ends on the last value", async () => {
    makeVideo();

    await dispatchMappedKey("o");
    await dispatchMappedKey("o");
    await dispatchMappedKey("o");
    await flush();

    expect(savedShowOverlays()).toEqual([false, true, false]);
    expect((storedSettings as unknown as ExtensionSettings).advancedSettings.showOverlays).toBe(
      false,
    );
    expect(showActionOverlayMock.mock.calls.map((call) => call[4])).toEqual([
      { overlayEnabled: false },
      { overlayEnabled: true },
      { overlayEnabled: false },
    ]);
  });

  it("keeps the newest toggle when settings reload before its save lands", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    vi.spyOn(video, "play").mockResolvedValue(undefined);
    // Hold the first write so the second toggle is still queued behind it.
    // When it lands, its change event reloads settings (overlays off) before
    // the second toggle (overlays on) has been written.
    let releaseFirstWrite = (): void => {};
    storageSetMock.mockImplementationOnce(async (settings: Record<string, unknown>) => {
      await new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      storedSettings = structuredClone(settings);
      void emitStorageChange();
    });

    await dispatchMappedKey("o");
    await flush();
    await dispatchMappedKey("o");
    releaseFirstWrite();
    await flush();
    showActionOverlayMock.mockClear();

    await dispatchMappedKey("k");
    expect(showActionOverlayMock).toHaveBeenCalledOnce();

    await flush();
    expect(savedShowOverlays()).toEqual([false, true]);
  });

  it("picks up a change made elsewhere while its save was pending", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    vi.spyOn(video, "play").mockResolvedValue(undefined);
    // Right after this frame's write lands, the settings page turns overlays
    // back on, and that change event reloads settings before the save settles.
    storageSetMock.mockImplementationOnce(async (settings: Record<string, unknown>) => {
      const written = structuredClone(settings) as unknown as ExtensionSettings;
      written.advancedSettings.showOverlays = true;
      storedSettings = written as unknown as Record<string, unknown>;
      void emitStorageChange();
    });

    await dispatchMappedKey("o");
    await flush();
    showActionOverlayMock.mockClear();

    await dispatchMappedKey("k");
    expect(showActionOverlayMock).toHaveBeenCalledOnce();
    expect(storageSetMock).toHaveBeenCalledOnce();
  });

  it("ignores an older settings read that finishes after the save settles", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    vi.spyOn(video, "play").mockResolvedValue(undefined);
    // A reload reads storage (overlays on) just before the toggle, and its
    // answer arrives only after the toggle has been saved.
    let releaseOldRead = (): void => {};
    storageGetMock.mockImplementationOnce(async () => {
      const snapshot = structuredClone(storedSettings);
      await new Promise<void>((resolve) => {
        releaseOldRead = resolve;
      });
      return snapshot;
    });
    void emitStorageChange();

    await dispatchMappedKey("o");
    await flush();
    releaseOldRead();
    await flush();
    showActionOverlayMock.mockClear();

    // Overlays are off, so playing shows nothing.
    await dispatchMappedKey("k");
    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(savedShowOverlays()).toEqual([false]);
  });

  it("goes back to the stored value when the save fails", async () => {
    makeVideo();
    storageSetMock.mockImplementationOnce(async () => {
      throw new Error("quota exceeded");
    });

    await dispatchMappedKey("o");
    await flush();
    await dispatchMappedKey("o");
    await flush();

    // Storage still says overlays are on, so the second press turns them off
    // rather than "back on".
    expect(savedShowOverlays()).toEqual([false, false]);
    expect(showActionOverlayMock.mock.calls.at(-1)?.[4]).toEqual({ overlayEnabled: false });
  });

  it("confirms only the newest toggle when an earlier one is still in arbitration", async () => {
    const localVideo = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    mockRect(localVideo, rect(0, 0, 512, 384));
    const child = makeChildFrame(rect(0, 0, 1024, 768), { holdScores: true });

    await dispatchMappedKey("o");
    await dispatchMappedKey("o");
    child.answerScoreRequests();
    await flush();

    expect(savedShowOverlays()).toEqual([false, true]);
    expect(child.executeRequests).toHaveLength(1);
    expect(child.executeRequests[0]).toMatchObject({ overlaysEnabled: true });
    expect(showActionOverlayMock).not.toHaveBeenCalled();
  });
});

describe("overlay toggle confirmation in another frame", () => {
  it("shows the value from the request without flipping or saving anything", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    vi.spyOn(video, "play").mockResolvedValue(undefined);
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);

    sendExecuteRequest(parentSource, { requestId: "overlay-off", overlaysEnabled: false });
    await flush();

    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "toggleOverlays",
      video,
      "center",
      expect.anything(),
      { overlayEnabled: false },
    );
    expect(parentSource.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "overlay-off", handled: true }),
      "*",
    );
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(storageSetMock).not.toHaveBeenCalled();

    // This frame's own setting only changes when storage reports it, so a
    // repeated or forged request can't turn its overlays off.
    showActionOverlayMock.mockClear();
    sendExecuteRequest(parentSource, { requestId: "play", action: "togglePlayPause" });
    await flush();
    expect(showActionOverlayMock).toHaveBeenCalledOnce();
  });

  it("passes the value on to the descendant frame the request is routed to", async () => {
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);
    const child = makeChildFrame(rect(0, 0, 1024, 768));
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentSource,
        data: {
          source: "media-hotkeys-extension",
          type: "MEDIA_HOTKEYS_SCORE_REQUEST",
          requestId: "routed",
          budgetMs: 100,
        },
      }),
    );
    await flush();

    sendExecuteRequest(parentSource, { requestId: "routed", overlaysEnabled: true });
    await flush();

    expect(child.executeRequests).toHaveLength(1);
    expect(child.executeRequests[0]).toMatchObject({
      action: "toggleOverlays",
      overlaysEnabled: true,
    });
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it("ignores a toggle request that doesn't say which value to show", async () => {
    makeVideo();
    const parentSource = { postMessage: vi.fn() } as unknown as Window;
    setWindowParentForTest(parentSource);

    sendExecuteRequest(parentSource, { requestId: "no-value" });
    sendExecuteRequest(parentSource, { requestId: "bad-value", overlaysEnabled: "yes" });
    await flush();

    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(parentSource.postMessage).not.toHaveBeenCalled();
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it("ignores a toggle request from a child frame", async () => {
    makeVideo();
    const child = makeChildFrame(rect(0, 0, 200, 150));

    sendExecuteRequest(child.childWindow, { requestId: "from-child", overlaysEnabled: false });
    await flush();

    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(storageSetMock).not.toHaveBeenCalled();
  });
});
