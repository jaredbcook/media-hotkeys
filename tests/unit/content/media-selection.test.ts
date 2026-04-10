import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeInvalidVideo, makeVideo, resetContentTestState } from "./helpers.js";
import { getTargetMedia, setSettingsForTests } from "../../../src/content.js";
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

  it("ignores an ambient focused media element", () => {
    const ambientVideo = makeVideo({
      muted: true,
      controls: false,
    } as Partial<HTMLVideoElement>);
    const primaryVideo = makeVideo();

    ambientVideo.tabIndex = 0;
    ambientVideo.focus();

    expect(document.activeElement).toBe(ambientVideo);
    expect(getTargetMedia()).toBe(primaryVideo);
  });

  it("ignores an invalid last interacted media element", async () => {
    const validVideo = makeVideo();
    const invalidVideo = makeInvalidVideo();
    await Promise.resolve();

    invalidVideo.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(validVideo);
  });

  it("ignores an ambient last interacted media element", async () => {
    const primaryVideo = makeVideo();
    const ambientVideo = makeVideo({
      muted: true,
      controls: false,
    } as Partial<HTMLVideoElement>);
    await Promise.resolve();

    ambientVideo.dispatchEvent(new Event("pointerdown"));

    expect(getTargetMedia()).toBe(primaryVideo);
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

  it("resets the last interacted media when the DOM changes", async () => {
    const first = makeVideo();
    const second = makeVideo();
    await Promise.resolve();

    second.dispatchEvent(new Event("pointerdown"));
    expect(getTargetMedia()).toBe(second);

    document.body.appendChild(document.createElement("div"));
    await Promise.resolve();

    expect(getTargetMedia()).toBe(first);
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
