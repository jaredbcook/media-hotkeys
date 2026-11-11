import { afterEach, beforeEach, vi, type MockInstance } from "vitest";

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

// The overlay's shadow root is closed, so the tests record it as it is attached.
const shadowRoots = new WeakMap<Element, ShadowRoot>();

/** The overlay's host element in the page, which holds position and visibility. */
export function getOverlayElement(): HTMLElement | null {
  // A page element may share the id; the host is the one the extension tagged.
  return document.querySelector<HTMLElement>(
    '#media-hotkeys-overlay[data-media-hotkeys-overlay="true"]',
  );
}

export function getOverlayShadowRoot(): ShadowRoot | null {
  const host = getOverlayElement();
  return (host && shadowRoots.get(host)) ?? null;
}

/** The overlay's box inside the shadow root, which holds the icon, text, and look. */
export function getOverlayBox(): HTMLElement | null {
  return getOverlayShadowRoot()?.querySelector("div") ?? null;
}

let attachShadowSpy: MockInstance<Element["attachShadow"]> | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  const attachShadow = Element.prototype.attachShadow;
  attachShadowSpy = vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attachShadow.call(this, init);
    shadowRoots.set(this, root);
    return root;
  });
});

afterEach(() => {
  attachShadowSpy?.mockRestore();
  vi.useRealTimers();
});
