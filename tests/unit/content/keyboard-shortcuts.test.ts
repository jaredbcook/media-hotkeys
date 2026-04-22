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

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockRect(element: Element, nextRect: DOMRect): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(nextRect);
}

function makePlaceholder({
  id,
  nextMedia,
  placeholderRect = rect(0, 0, 320, 180),
  playIconRect = rect(128, 67, 64, 46),
}: {
  id: string;
  nextMedia?: HTMLMediaElement;
  placeholderRect?: DOMRect;
  playIconRect?: DOMRect;
}): HTMLDivElement {
  const placeholder = document.createElement("div");
  placeholder.id = id;
  placeholder.style.backgroundImage = 'url("https://example.com/thumb.png")';
  placeholder.style.cursor = "pointer";
  placeholder.textContent = "6:37";

  const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  placeholder.appendChild(playIcon);
  document.body.appendChild(placeholder);

  mockRect(placeholder, placeholderRect);
  mockRect(playIcon, playIconRect);

  if (nextMedia) {
    placeholder.addEventListener("click", () => {
      document.body.appendChild(nextMedia);
    });
  }

  return placeholder;
}

async function settleHotkey(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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

  it("does not prevent a mapped key from typing in a textarea when no media exists", async () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    textarea.dispatchEvent(event);
    await Promise.resolve();

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not prevent mapped keys from shadow DOM textareas", async () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const textarea = document.createElement("textarea");
    shadowRoot.appendChild(textarea);
    document.body.appendChild(host);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    textarea.dispatchEvent(event);
    await Promise.resolve();

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
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

describe("playable placeholder activation", () => {
  it("clicks a Skool-like placeholder and plays injected paused media", async () => {
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/injected.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const placeholder = makePlaceholder({ id: "placeholder", nextMedia: video });
    const clickSpy = vi.spyOn(placeholder, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("uses the most visible matching placeholder", async () => {
    const smallVideo = document.createElement("video");
    smallVideo.setAttribute("src", "https://example.com/small.mp4");
    const largeVideo = document.createElement("video");
    largeVideo.setAttribute("src", "https://example.com/large.mp4");
    vi.spyOn(largeVideo, "play").mockResolvedValue(undefined);

    const small = makePlaceholder({
      id: "small-placeholder",
      nextMedia: smallVideo,
      placeholderRect: rect(0, 0, 160, 90),
      playIconRect: rect(48, 22, 64, 46),
    });
    const large = makePlaceholder({
      id: "large-placeholder",
      nextMedia: largeVideo,
      placeholderRect: rect(0, 120, 480, 270),
      playIconRect: rect(208, 232, 64, 46),
    });
    const smallClickSpy = vi.spyOn(small, "click");
    const largeClickSpy = vi.spyOn(large, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(smallClickSpy).not.toHaveBeenCalled();
    expect(largeClickSpy).toHaveBeenCalledOnce();
  });

  it("ignores weak or unsafe placeholder candidates", async () => {
    const validVideo = document.createElement("video");
    validVideo.setAttribute("src", "https://example.com/valid.mp4");
    vi.spyOn(validVideo, "play").mockResolvedValue(undefined);

    const hidden = makePlaceholder({ id: "hidden" });
    hidden.style.display = "none";
    const offscreen = makePlaceholder({
      id: "offscreen",
      placeholderRect: rect(1200, 0, 320, 180),
      playIconRect: rect(1328, 67, 64, 46),
    });
    const tiny = makePlaceholder({
      id: "tiny",
      placeholderRect: rect(0, 220, 40, 30),
      playIconRect: rect(8, 8, 24, 20),
    });
    const editable = makePlaceholder({ id: "editable" });
    editable.setAttribute("contenteditable", "true");
    const valid = makePlaceholder({
      id: "valid",
      nextMedia: validVideo,
      placeholderRect: rect(0, 440, 320, 180),
      playIconRect: rect(128, 507, 64, 46),
    });

    const hiddenClickSpy = vi.spyOn(hidden, "click");
    const offscreenClickSpy = vi.spyOn(offscreen, "click");
    const tinyClickSpy = vi.spyOn(tiny, "click");
    const editableClickSpy = vi.spyOn(editable, "click");
    const validClickSpy = vi.spyOn(valid, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(hiddenClickSpy).not.toHaveBeenCalled();
    expect(offscreenClickSpy).not.toHaveBeenCalled();
    expect(tinyClickSpy).not.toHaveBeenCalled();
    expect(editableClickSpy).not.toHaveBeenCalled();
    expect(validClickSpy).toHaveBeenCalledOnce();
  });

  it("does not activate placeholders for non-play actions", async () => {
    const placeholder = makePlaceholder({ id: "placeholder" });
    const clickSpy = vi.spyOn(placeholder, "click");

    await dispatchMappedKey("m");
    await settleHotkey();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("does not activate placeholders when targetable media already exists", async () => {
    const placeholder = makePlaceholder({ id: "placeholder" });
    const clickSpy = vi.spyOn(placeholder, "click");
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(clickSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("does not replay media that starts playing after placeholder activation", async () => {
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/playing.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    makePlaceholder({ id: "placeholder", nextMedia: video });

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(playSpy).not.toHaveBeenCalled();
  });
});
