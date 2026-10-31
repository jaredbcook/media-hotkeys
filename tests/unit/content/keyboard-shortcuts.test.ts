import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchMappedKey,
  makeVideo,
  mockRect,
  rect,
  resetContentTestState,
  showActionOverlayMock,
  storageSetMock,
} from "./helpers.js";
import { setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

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

  it("does not prevent mapped keys when the top-level URL matches a disabled site rule", async () => {
    window.history.pushState({}, "", "/shorts/clip");
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["localhost/shorts"];
    setSettingsForTests(settings);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    document.dispatchEvent(event);
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("handles mapped keys when the top-level URL does not match a disabled path rule", async () => {
    window.history.pushState({}, "", "/watch/clip");
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["localhost/shorts"];
    setSettingsForTests(settings);

    await dispatchMappedKey("k");

    expect(playSpy).toHaveBeenCalled();
  });

  it("applies path rules after the page navigates in place", async () => {
    window.history.pushState({}, "", "/watch/clip");
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost/shorts", policy: "disabled", embedsPolicy: "inherit" },
    ];
    setSettingsForTests(settings);

    window.history.pushState({}, "", "/shorts/clip");
    await dispatchMappedKey("k");
    expect(playSpy).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/watch/other");
    await dispatchMappedKey("k");
    expect(playSpy).toHaveBeenCalled();
  });

  it("handles mapped keys when a specific enabled rule overrides a broad disabled rule", async () => {
    window.history.pushState({}, "", "/shorts/clip");
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.siteSettings.sitePolicies = [
      { pattern: "localhost", policy: "disabled", embedsPolicy: "inherit" },
      { pattern: "localhost/shorts", policy: "enabled", embedsPolicy: "inherit" },
    ];
    settings.siteSettings.disabledUrlPatterns = ["localhost"];
    setSettingsForTests(settings);

    await dispatchMappedKey("k");

    expect(playSpy).toHaveBeenCalled();
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

  it("leaves the overlay toggle key to the page when no media is present", async () => {
    await dispatchMappedKey("o");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    await dispatchMappedKey("k");

    expect(playSpy).toHaveBeenCalled();
    expect(showActionOverlayMock).toHaveBeenCalled();
    expect(storageSetMock).not.toHaveBeenCalled();
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

  it.each(["range", "checkbox", "radio", "button"])(
    "handles hotkeys while a %s input has focus",
    async (type) => {
      const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      const input = document.createElement("input");
      input.type = type;
      document.body.appendChild(input);
      input.focus();

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
      await Promise.resolve();

      expect(playSpy).toHaveBeenCalled();
    },
  );

  it.each(["text", "search", "number", "email"])(
    "skips hotkeys while a %s input has focus",
    async (type) => {
      const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      const input = document.createElement("input");
      input.type = type;
      document.body.appendChild(input);
      input.focus();

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
      await Promise.resolve();

      expect(playSpy).not.toHaveBeenCalled();
    },
  );

  it("leaves arrow keys to a focused slider", async () => {
    makeVideo({ paused: true, currentTime: 20, duration: 100 } as Partial<HTMLVideoElement>);
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.appendChild(slider);
    slider.focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });

    slider.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(false);
  });

  it("takes a held toggle key from the page without toggling again", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("keeps stepping while a seek key is held", async () => {
    const video = makeVideo({
      paused: true,
      currentTime: 20,
      duration: 100,
    } as Partial<HTMLVideoElement>);

    await dispatchMappedKey("ArrowRight", { repeat: true });
    await dispatchMappedKey("ArrowRight", { repeat: true });

    expect(video.currentTime).toBe(30);
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

  it("matches a key typed with AltGr, which reports Ctrl+Alt", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("still ignores Meta pressed together with AltGr", async () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>);
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      modifierAltGraph: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await Promise.resolve();

    expect(playSpy).not.toHaveBeenCalled();
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

  it("clicks the specific video attachment, not a larger post wrapper that inherits its signals", async () => {
    // Mirrors Skool's structure: a big post-card wrapper contains an unrelated
    // enabled link (author profile) plus the actual video attachment. The
    // wrapper's querySelectorAll-based signals (duration text, thumbnail,
    // play icon, clickable descendant) would otherwise let it outscore and
    // shadow the real click target.
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/skool.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const postCard = document.createElement("div");
    postCard.id = "post-card";
    const authorLink = document.createElement("a");
    authorLink.href = "https://example.com/profile";
    authorLink.textContent = "Some Author";
    postCard.appendChild(authorLink);

    const attachment = document.createElement("div");
    attachment.id = "video-attachment";
    attachment.style.cursor = "zoom-in";
    const durationText = document.createElement("div");
    durationText.textContent = "1:57:56";
    const thumbnail = document.createElement("div");
    thumbnail.style.backgroundImage = 'url("https://example.com/thumb.png")';
    const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    attachment.append(durationText, thumbnail, playIcon);
    postCard.appendChild(attachment);
    document.body.appendChild(postCard);

    mockRect(postCard, rect(0, 0, 768, 532));
    mockRect(authorLink, rect(8, 8, 100, 20));
    mockRect(attachment, rect(0, 300, 369, 210));
    mockRect(thumbnail, rect(0, 300, 369, 210));
    mockRect(playIcon, rect(152, 383, 64, 46));

    attachment.addEventListener("click", () => {
      document.body.appendChild(video);
    });
    const attachmentClickSpy = vi.spyOn(attachment, "click");
    const postCardClickSpy = vi.spyOn(postCard, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(attachmentClickSpy).toHaveBeenCalledOnce();
    expect(postCardClickSpy).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("clicks the real placeholder instead of an aria-disabled ancestor wrapper", async () => {
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/disabled-wrapper.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const attachment = document.createElement("div");
    attachment.id = "attachment-with-disabled-wrapper";
    attachment.style.cursor = "zoom-in";
    attachment.textContent = "6:37";

    const disabledWrapper = document.createElement("div");
    disabledWrapper.setAttribute("role", "button");
    disabledWrapper.setAttribute("tabindex", "0");
    disabledWrapper.setAttribute("aria-disabled", "true");
    const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    disabledWrapper.appendChild(playIcon);
    attachment.appendChild(disabledWrapper);
    document.body.appendChild(attachment);

    mockRect(attachment, rect(0, 0, 320, 180));
    mockRect(disabledWrapper, rect(128, 67, 64, 46));
    mockRect(playIcon, rect(128, 67, 64, 46));

    attachment.addEventListener("click", () => {
      document.body.appendChild(video);
    });
    const attachmentClickSpy = vi.spyOn(attachment, "click");
    const disabledWrapperClickSpy = vi.spyOn(disabledWrapper, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(disabledWrapperClickSpy).not.toHaveBeenCalled();
    expect(attachmentClickSpy).toHaveBeenCalledOnce();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("clicks a YouTube cued-embed play button even without duration text", async () => {
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/cued.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const container = document.createElement("div");
    container.id = "cued-embed";
    const thumbnail = document.createElement("div");
    thumbnail.style.backgroundImage = 'url("https://i.ytimg.com/vi_webp/abc/maxresdefault.webp")';
    const playButton = document.createElement("button");
    playButton.setAttribute("aria-label", "Play video");
    playButton.title = "Play video";
    container.append(thumbnail, playButton);
    document.body.appendChild(container);

    mockRect(container, rect(0, 0, 640, 360));
    mockRect(thumbnail, rect(0, 0, 640, 360));
    mockRect(playButton, rect(288, 157, 64, 46));
    playButton.addEventListener("click", () => {
      document.body.appendChild(video);
    });
    const buttonClickSpy = vi.spyOn(playButton, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(buttonClickSpy).toHaveBeenCalledOnce();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("does not treat a duration-less watch link as a playable placeholder", async () => {
    const container = document.createElement("div");
    container.id = "watch-link-only";
    const thumbnail = document.createElement("div");
    thumbnail.style.backgroundImage = 'url("https://example.com/thumb.png")';
    const watchLink = document.createElement("a");
    watchLink.href = "https://www.youtube.com/watch?v=abc";
    watchLink.setAttribute("aria-label", "Watch on YouTube");
    container.append(thumbnail, watchLink);
    document.body.appendChild(container);

    mockRect(container, rect(0, 0, 640, 360));
    mockRect(thumbnail, rect(0, 0, 640, 360));
    mockRect(watchLink, rect(288, 157, 64, 46));
    const linkClickSpy = vi.spyOn(watchLink, "click");
    const containerClickSpy = vi.spyOn(container, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(linkClickSpy).not.toHaveBeenCalled();
    expect(containerClickSpy).not.toHaveBeenCalled();
  });

  it("clicks a lite-youtube facade whose play label is visually hidden text", async () => {
    // lite-youtube-embed: no aria-label/title, just <span class="lyt-visually-hidden">Play</span>.
    const host = document.createElement("lite-youtube");
    host.style.backgroundImage = 'url("https://i.ytimg.com/vi/abc/hqdefault.jpg")';
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "lyt-playbtn lty-playbtn";
    const hiddenLabel = document.createElement("span");
    hiddenLabel.className = "lyt-visually-hidden";
    hiddenLabel.textContent = "Play";
    playButton.appendChild(hiddenLabel);
    host.appendChild(playButton);
    document.body.appendChild(host);

    mockRect(host, rect(0, 0, 640, 360));
    mockRect(playButton, rect(0, 0, 640, 360));
    mockRect(hiddenLabel, rect(0, 0, 1, 1));
    const buttonClickSpy = vi.spyOn(playButton, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(buttonClickSpy).toHaveBeenCalledOnce();
  });

  it("recognizes a localized play button label", async () => {
    const container = document.createElement("div");
    container.style.backgroundImage = 'url("https://i.ytimg.com/vi/abc/hqdefault.jpg")';
    const playButton = document.createElement("button");
    playButton.setAttribute("aria-label", "Reproducir video");
    container.appendChild(playButton);
    document.body.appendChild(container);

    mockRect(container, rect(0, 0, 640, 360));
    mockRect(playButton, rect(284, 144, 72, 72));
    const buttonClickSpy = vi.spyOn(playButton, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(buttonClickSpy).toHaveBeenCalledOnce();
  });

  it("clicks a duration-less facade with a centered class-named play overlay", async () => {
    // WP Rocket's lazy YouTube: <div data-id><img><div class="play"></div></div>.
    const video = document.createElement("video");
    video.setAttribute("src", "https://example.com/facade.mp4");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    const facade = document.createElement("div");
    facade.dataset.id = "abc";
    facade.style.cursor = "pointer";
    const thumbnail = document.createElement("img");
    thumbnail.src = "https://i.ytimg.com/vi/abc/hqdefault.jpg";
    const playOverlay = document.createElement("div");
    playOverlay.className = "play";
    facade.append(thumbnail, playOverlay);
    document.body.appendChild(facade);

    mockRect(facade, rect(0, 0, 480, 270));
    mockRect(thumbnail, rect(0, 0, 480, 270));
    mockRect(playOverlay, rect(206, 103, 68, 64));
    // The overlay inherits the pointer cursor, so the click may land on it and
    // bubble to the facade's handler, as it does in a browser.
    const facadeClickHandler = vi.fn(() => {
      facade.replaceChildren(video);
    });
    facade.addEventListener("click", facadeClickHandler);

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(facadeClickHandler).toHaveBeenCalledOnce();
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it("does not count class names like player or display as play overlays", async () => {
    const container = document.createElement("div");
    container.className = "video-player";
    container.style.backgroundImage = 'url("https://example.com/thumb.png")';
    const overlay = document.createElement("div");
    overlay.className = "display-badge";
    container.appendChild(overlay);
    document.body.appendChild(container);

    mockRect(container, rect(0, 0, 640, 360));
    mockRect(overlay, rect(284, 144, 72, 72));
    const containerClickSpy = vi.spyOn(container, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(containerClickSpy).not.toHaveBeenCalled();
  });

  it("never clicks a thumbnail card that links to another page on the same site", async () => {
    // YouTube search results / TED talk grid: <a href="/watch?v=…"> thumbnails
    // with duration badges. Clicking would navigate away from the page.
    const row = document.createElement("div");
    row.id = "result-row";
    row.style.cursor = "pointer";
    const card = document.createElement("a");
    card.href = "/watch?v=abc";
    card.style.backgroundImage = 'url("https://i.ytimg.com/vi/abc/hqdefault.jpg")';
    const duration = document.createElement("span");
    duration.textContent = "10:35";
    const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    card.append(duration, playIcon);
    row.appendChild(card);
    document.body.appendChild(row);

    mockRect(row, rect(0, 0, 1160, 281));
    mockRect(card, rect(0, 0, 500, 281));
    mockRect(playIcon, rect(218, 108, 64, 64));
    const cardClickSpy = vi.spyOn(card, "click");
    const rowClickSpy = vi.spyOn(row, "click");

    await dispatchMappedKey("k");
    await settleHotkey();

    expect(cardClickSpy).not.toHaveBeenCalled();
    expect(rowClickSpy).not.toHaveBeenCalled();
  });

  it("lets a facade claim a click on its provider link but cancels unclaimed navigation", async () => {
    const makeLinkedFacade = (id: string, top: number): HTMLAnchorElement => {
      const link = document.createElement("a");
      link.id = id;
      link.href = "https://www.youtube.com/watch?v=abc";
      link.style.backgroundImage = 'url("https://i.ytimg.com/vi/abc/hqdefault.jpg")';
      const playButton = document.createElement("span");
      playButton.className = "play-button";
      link.appendChild(playButton);
      document.body.appendChild(link);
      mockRect(link, rect(0, top, 640, 360));
      mockRect(playButton, rect(284, top + 144, 72, 72));
      return link;
    };

    const navigationDefaults: boolean[] = [];
    const recordNavigation = (event: Event): void => {
      navigationDefaults.push(event.defaultPrevented);
    };

    // A facade script that intercepts its own link (the progressive-enhancement pattern).
    const claimedFacade = makeLinkedFacade("claimed", 0);
    claimedFacade.addEventListener("click", (event) => event.preventDefault());
    document.addEventListener("click", recordNavigation);

    await dispatchMappedKey("k");
    await settleHotkey();
    expect(navigationDefaults).toEqual([true]);

    // Without a handler, the extension itself must cancel the navigation.
    claimedFacade.remove();
    makeLinkedFacade("unclaimed", 0);
    let navigationCancelled = false;
    window.addEventListener(
      "click",
      (event) => {
        // Runs before the extension's own guard is registered, so check after dispatch.
        queueMicrotask(() => {
          navigationCancelled = event.defaultPrevented;
        });
      },
      { once: true },
    );

    await dispatchMappedKey("k");
    await settleHotkey();
    document.removeEventListener("click", recordNavigation);

    expect(navigationCancelled).toBe(true);
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
