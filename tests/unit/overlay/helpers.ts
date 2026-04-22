import { afterEach, beforeEach, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { sync: { get: vi.fn(async () => ({})), set: vi.fn() } },
  },
}));

interface VideoRectOptions {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

interface MakeVideoOptions extends VideoRectOptions {
  display?: string;
  visibility?: string;
  opacity?: string;
  hidden?: boolean;
}

export function makeVideo(
  widthOrOptions: number | MakeVideoOptions = 640,
  height = 360,
): HTMLVideoElement {
  const video = document.createElement("video");
  document.body.appendChild(video);

  const options =
    typeof widthOrOptions === "number"
      ? { left: 100, top: 100, width: widthOrOptions, height }
      : {
          left: 100,
          top: 100,
          width: 640,
          height: 360,
          ...widthOrOptions,
        };

  if (options.display) {
    video.style.display = options.display;
  }

  if (options.visibility) {
    video.style.visibility = options.visibility;
  }

  if (options.opacity) {
    video.style.opacity = options.opacity;
  }

  if (options.hidden) {
    video.hidden = true;
  }

  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    left: options.left,
    top: options.top,
    width: options.width,
    height: options.height,
    right: options.left + options.width,
    bottom: options.top + options.height,
    x: options.left,
    y: options.top,
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
