import { afterEach, beforeEach, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { sync: { get: vi.fn(async (d: unknown) => d), set: vi.fn() } },
  },
}));

export function makeVideo(width = 640, height = 360): HTMLVideoElement {
  const video = document.createElement("video");
  document.body.appendChild(video);
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width,
    height,
    right: 100 + width,
    bottom: 100 + height,
    x: 100,
    y: 100,
    toJSON: () => {},
  });
  return video;
}

export function getOverlayElement(): HTMLElement | null {
  return document.getElementById("media-shortcuts-overlay");
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
