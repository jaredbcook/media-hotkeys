import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeInvalidVideo, makeVideo, mockRect, rect, resetContentTestState } from "./helpers.js";
import { getTargetMedia, handleAction, setSettingsForTests } from "../../../src/content.js";
import { DEFAULT_SETTINGS } from "../../../src/storage.js";

beforeEach(() => {
  resetContentTestState();
});

describe("media target selection", () => {
  it("returns null when no media is present", () => {
    expect(getTargetMedia()).toBeNull();
  });

  it("returns the first media element as fallback", () => {
    const video = makeVideo();
    expect(getTargetMedia()).toBe(video);
  });

  it("ignores ambient videos when choosing a fallback target", () => {
    makeVideo({
      muted: true,
      controls: false,
    } as Partial<HTMLVideoElement>);
    const primaryVideo = makeVideo();

    expect(getTargetMedia()).toBe(primaryVideo);
  });

  it("ignores invalid media elements when choosing a fallback target", () => {
    makeInvalidVideo();
    const validVideo = makeVideo();

    expect(getTargetMedia()).toBe(validVideo);
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

  it("ignores ambient videos even when they are playing", () => {
    makeVideo({
      muted: true,
      controls: false,
      paused: false,
      ended: false,
      readyState: 4,
    } as Partial<HTMLVideoElement>);
    const primaryVideo = makeVideo();

    expect(getTargetMedia()).toBe(primaryVideo);
  });

  it("ignores an invalid focused media element", () => {
    const invalidFocused = makeInvalidVideo();
    const validVideo = makeVideo();

    invalidFocused.tabIndex = 0;
    invalidFocused.focus();

    expect(document.activeElement).toBe(invalidFocused);
    expect(getTargetMedia()).toBe(validVideo);
  });

  it("targets an ambient video when the user focuses it", () => {
    // Direct user intent (focus) outweighs the ambient-media penalty.
    const ambientVideo = makeVideo({
      muted: true,
      controls: false,
    } as Partial<HTMLVideoElement>);
    makeVideo();

    ambientVideo.tabIndex = 0;
    ambientVideo.focus();

    expect(document.activeElement).toBe(ambientVideo);
    expect(getTargetMedia()).toBe(ambientVideo);
  });

  it("ignores an invalid last interacted media element", async () => {
    const validVideo = makeVideo();
    const invalidVideo = makeInvalidVideo();
    await Promise.resolve();

    invalidVideo.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(validVideo);
  });

  it("targets an ambient video after the user interacts with it", async () => {
    // Interaction recency outweighs the ambient-media penalty.
    makeVideo();
    const ambientVideo = makeVideo({
      muted: true,
      controls: false,
    } as Partial<HTMLVideoElement>);
    await Promise.resolve();

    ambientVideo.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(ambientVideo);
  });

  it("retargets a muted no-controls video after a successful extension action", async () => {
    const customPlayerVideo = makeVideo({
      controls: false,
      muted: false,
      volume: 0.5,
    } as Partial<HTMLVideoElement>);

    expect(getTargetMedia()).toBe(customPlayerVideo);

    handleAction("toggleMute", customPlayerVideo);

    expect(customPlayerVideo.muted).toBe(true);

    document.body.appendChild(document.createElement("div"));
    await Promise.resolve();

    expect(getTargetMedia()).toBe(customPlayerVideo);
  });

  it("still targets muted videos when native controls are present", () => {
    const controlledMutedVideo = makeVideo({
      muted: true,
      controls: true,
    } as Partial<HTMLVideoElement>);

    expect(getTargetMedia()).toBe(controlledMutedVideo);
  });

  it("treats media with a child source src as valid", () => {
    const video = document.createElement("video");
    const source = document.createElement("source");
    source.setAttribute("src", "https://example.com/test.mp4");
    video.appendChild(source);
    document.body.appendChild(video);

    expect(getTargetMedia()).toBe(video);
  });

  it("tracks media added after initialization", async () => {
    const initial = makeVideo();
    const addedLater = document.createElement("video");
    addedLater.setAttribute("src", "https://example.com/later.mp4");

    document.body.appendChild(addedLater);
    await Promise.resolve();
    addedLater.dispatchEvent(new Event("play"));

    expect(getTargetMedia()).toBe(addedLater);

    initial.remove();
    addedLater.remove();
  });

  it("logs tracked media events when debug logging is enabled", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const video = document.createElement("video");
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.advancedSettings.debugLogging = true;
    setSettingsForTests(settings);

    document.body.appendChild(video);
    await Promise.resolve();
    video.dispatchEvent(new Event("play"));

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[Media Hotkeys][debug] Tracked media interaction",
      expect.objectContaining({
        event: "play",
        tagName: "VIDEO",
      }),
    );
  });

  it("keeps the last interacted media through unrelated DOM changes", async () => {
    const first = makeVideo();
    const second = makeVideo();
    await Promise.resolve();

    second.dispatchEvent(new Event("pointerdown"));
    expect(getTargetMedia()).toBe(second);

    document.body.appendChild(document.createElement("div"));
    await Promise.resolve();

    expect(getTargetMedia()).toBe(second);

    first.remove();
    second.remove();
  });

  it("forgets the last interacted media once it is removed from the DOM", async () => {
    const first = makeVideo();
    const second = makeVideo();
    await Promise.resolve();

    second.dispatchEvent(new Event("pointerdown"));
    expect(getTargetMedia()).toBe(second);

    second.remove();
    await Promise.resolve();

    expect(getTargetMedia()).toBe(first);
  });

  it("does not reset the last interacted media for extension-managed overlay DOM changes", async () => {
    const first = makeVideo();
    const second = makeVideo();
    await Promise.resolve();

    second.dispatchEvent(new Event("pointerdown"));
    expect(getTargetMedia()).toBe(second);

    const overlay = document.createElement("div");
    overlay.id = "media-shortcuts-overlay";
    document.body.appendChild(overlay);
    await Promise.resolve();

    expect(getTargetMedia()).toBe(second);

    first.remove();
    second.remove();
    overlay.remove();
  });

  it("prefers audible playing media over muted playing media", () => {
    makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
      muted: true,
      controls: true,
    } as Partial<HTMLVideoElement>);
    const audible = makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
    } as Partial<HTMLVideoElement>);

    expect(getTargetMedia()).toBe(audible);
  });

  it("prefers recently interacted media over muted playing media", async () => {
    // The "ad starts playing elsewhere" scenario: the user's paused video
    // should stay targeted over an unrelated muted autoplaying element.
    const interacted = makeVideo();
    const mutedPlaying = makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
      muted: true,
      controls: true,
    } as Partial<HTMLVideoElement>);
    await Promise.resolve();

    interacted.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(interacted);

    interacted.remove();
    mutedPlaying.remove();
  });

  it("prefers audible playing media over recently interacted media", async () => {
    const interacted = makeVideo();
    const audible = makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
    } as Partial<HTMLVideoElement>);
    await Promise.resolve();

    interacted.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(audible);

    interacted.remove();
    audible.remove();
  });

  it("prefers focused media over audible playing media", () => {
    const audible = makeVideo({
      paused: false,
      ended: false,
      readyState: 4,
    } as Partial<HTMLVideoElement>);
    const focused = makeVideo();

    focused.tabIndex = 0;
    focused.focus();

    expect(document.activeElement).toBe(focused);
    expect(getTargetMedia()).toBe(focused);

    audible.remove();
    focused.remove();
  });

  it("tracks media added inside a shadow root after initialization", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });
    const shadowVideo = document.createElement("video");
    shadowVideo.setAttribute("src", "https://example.com/shadow.mp4");
    shadowRoot.appendChild(shadowVideo);

    await Promise.resolve();
    shadowVideo.dispatchEvent(new Event("play"));
    await Promise.resolve();

    expect(getTargetMedia()).toBe(shadowVideo);
  });
});

describe("pointer intent signals", () => {
  function pointerAt(
    type: string,
    x: number,
    y: number,
    target: EventTarget = document.body,
  ): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  }

  it("attributes clicks on custom player chrome over a video to that video", async () => {
    // Custom players stack their controls above the <video>, so the press
    // lands on an overlay element, never on the media element itself.
    const first = makeVideo();
    const second = makeVideo();
    mockRect(first, rect(0, 0, 400, 225));
    mockRect(second, rect(0, 300, 400, 225));
    const controlsOverlay = document.createElement("button");
    controlsOverlay.setAttribute("aria-label", "Mute (m)");
    document.body.appendChild(controlsOverlay);
    await Promise.resolve();

    expect(getTargetMedia()).toBe(first);

    pointerAt("pointerdown", 30, 500, controlsOverlay);
    // Moving away afterwards must not drop the remembered interaction.
    document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));

    expect(getTargetMedia()).toBe(second);
  });

  it("ignores pointer presses outside every video box", async () => {
    const first = makeVideo();
    const second = makeVideo();
    mockRect(first, rect(0, 0, 400, 225));
    mockRect(second, rect(0, 300, 400, 225));
    await Promise.resolve();

    pointerAt("pointerdown", 700, 700);

    expect(getTargetMedia()).toBe(first);
  });

  it("prefers the hovered video between otherwise equal candidates", () => {
    const first = makeVideo();
    const second = makeVideo();
    mockRect(first, rect(0, 0, 400, 225));
    mockRect(second, rect(0, 300, 400, 225));

    pointerAt("pointermove", 200, 400);
    expect(getTargetMedia()).toBe(second);

    document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));
    expect(getTargetMedia()).toBe(first);
  });

  it("does not let hover alone make a background video targetable", () => {
    const ambient = makeVideo({ muted: true, controls: false } as Partial<HTMLVideoElement>);
    mockRect(ambient, rect(0, 0, 1024, 768));

    pointerAt("pointermove", 500, 400);

    expect(getTargetMedia()).toBeNull();
  });

  it("still treats media as playing while it is buffering", () => {
    makeVideo();
    const buffering = makeVideo({
      paused: false,
      ended: false,
      readyState: 2,
    } as Partial<HTMLVideoElement>);

    expect(getTargetMedia()).toBe(buffering);
  });
});
