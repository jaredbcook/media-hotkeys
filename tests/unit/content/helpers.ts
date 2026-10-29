import { afterAll, vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

type StorageChangeListener = (changes: Record<string, unknown>, areaName: string) => void;

const {
  showActionOverlayMock,
  storageChangeListeners,
  storageGetMock,
  storageOnChangedAddListenerMock,
  storageSetMock,
} = vi.hoisted(() => {
  const storageChangeListeners: StorageChangeListener[] = [];

  return {
    showActionOverlayMock: vi.fn(),
    storageChangeListeners,
    storageGetMock: vi.fn(async () => ({})),
    storageOnChangedAddListenerMock: vi.fn((listener: StorageChangeListener) => {
      storageChangeListeners.push(listener);
    }),
    storageSetMock: vi.fn(async () => undefined),
  };
});

vi.mock("webextension-polyfill", () => {
  return {
    default: {
      storage: {
        onChanged: {
          addListener: storageOnChangedAddListenerMock,
        },
        sync: {
          get: storageGetMock,
          set: storageSetMock,
        },
      },
    },
  };
});

vi.mock("../../../src/overlay.js", () => ({
  showActionOverlay: showActionOverlayMock,
}));

import { setSettingsForTests } from "../../../src/content.js";

const DEFAULT_SETTINGS = defaults as ExtensionSettings;

// Placeholder activation polls for media for up to a second after its click.
// Stop leftover polling after every test, so it can't act on the next test's
// page or run after the test environment is torn down.
const pendingIntervals = new Set<number>();
const originalSetInterval = window.setInterval.bind(window);
window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
  const id = originalSetInterval(...args);
  pendingIntervals.add(id);
  return id;
}) as typeof window.setInterval;

afterEach(() => {
  for (const id of pendingIntervals) {
    window.clearInterval(id);
  }
  pendingIntervals.clear();
});

// jsdom empties the body when Vitest tears the environment down, after the
// window globals are gone. Empty it first so the content script's mutation
// observer doesn't run without a window.
afterAll(async () => {
  document.body.replaceChildren();
  await Promise.resolve();
});

export function makeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  const video = document.createElement("video");
  video.setAttribute("src", "https://example.com/test.mp4");

  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(video, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  document.body.appendChild(video);
  return video;
}

export function makeInvalidVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  document.body.appendChild(video);
  return video;
}

export function rect(left: number, top: number, width: number, height: number): DOMRect {
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

export function mockRect(element: Element, nextRect: DOMRect): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(nextRect);
}

export function resetContentTestState(): void {
  window.history.pushState({}, "", "/");
  document.body.innerHTML = "";
  // Forget the pointer position tracked for the hover signal.
  document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));
  vi.restoreAllMocks();
  storageGetMock.mockImplementation(async () => ({}));
  storageSetMock.mockReset();
  showActionOverlayMock.mockReset();
  setSettingsForTests(structuredClone(DEFAULT_SETTINGS));
}

export async function dispatchMappedKey(key: string, init?: KeyboardEventInit): Promise<void> {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  await Promise.resolve();
}

export async function emitStorageChange(areaName = "sync"): Promise<void> {
  for (const listener of storageChangeListeners) {
    listener({}, areaName);
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
}

export { showActionOverlayMock, storageGetMock, storageSetMock };
