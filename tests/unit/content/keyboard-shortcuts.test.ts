import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchMappedKey,
  makeVideo,
  resetContentTestState,
  showActionOverlayMock,
  storageSetMock,
} from "./helpers.js";
import { setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

describe("keyboard shortcut routing", () => {
  it("performs an action on a mapped key when media is present", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("k");

    expect(playSpy).toHaveBeenCalled();
  });

  it("does nothing for an unmapped key", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("Q");

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("ignores mapped keys when hotkeys are disabled", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.quickSettings.hotkeysEnabled = false;
    setSettingsForTests(settings);

    await dispatchMappedKey("k");

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no media exists for a mapped key", async () => {
    await dispatchMappedKey("k");
  });

  it("matches shifted letters against lowercase alpha bindings", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("K", { shiftKey: true });

    expect(playSpy).toHaveBeenCalled();
  });

  it("handles a shifted mapped key for speed controls", async () => {
    const video = makeVideo();
    video.playbackRate = 1.0;

    await dispatchMappedKey(">", { shiftKey: true });

    expect(video.playbackRate).toBeCloseTo(1.25);
  });

  it("toggles overlays off even when no media is present", async () => {
    await dispatchMappedKey("o");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("k");

    expect(playSpy).toHaveBeenCalled();
    expect(showActionOverlayMock).not.toHaveBeenCalled();
    expect(storageSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        advancedSettings: expect.objectContaining({ showOverlays: false }),
      }),
    );
  });

  it("shows the overlays toggle confirmation when media is present", async () => {
    const video = makeVideo();

    await dispatchMappedKey("o");

    expect(showActionOverlayMock).toHaveBeenCalledWith(
      "toggleOverlays",
      video,
      "center",
      expect.anything(),
      { overlayEnabled: false },
    );
  });

  it("uses number keys to jump to percentages only when enabled", async () => {
    const video = makeVideo({ currentTime: 0, duration: 100 } as Partial<HTMLVideoElement>);
    video.focus();

    await dispatchMappedKey("5");
    expect(video.currentTime).toBe(50);

    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.useNumberKeysToJump = false;
    setSettingsForTests(settings);
    video.currentTime = 0;

    await dispatchMappedKey("5");
    expect(video.currentTime).toBe(0);
  });

  it.each([
    [
      "input",
      () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
      },
    ],
    [
      "textarea",
      () => {
        const textarea = document.createElement("textarea");
        document.body.appendChild(textarea);
        textarea.focus();
      },
    ],
    [
      "select",
      () => {
        const select = document.createElement("select");
        document.body.appendChild(select);
        select.focus();
      },
    ],
  ] as const)("skips action when the active element is a %s", async (_name, focusEditable) => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    focusEditable();
    await dispatchMappedKey("k");

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("skips action when the active element is contenteditable", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const div = document.createElement("div");
    document.body.appendChild(div);
    Object.defineProperty(div, "isContentEditable", { get: () => true, configurable: true });
    vi.spyOn(document, "activeElement", "get").mockReturnValue(div);

    await dispatchMappedKey("k");

    expect(playSpy).not.toHaveBeenCalled();
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
