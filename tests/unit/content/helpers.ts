import { vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

type StorageChangeListener = (changes: Record<string, unknown>, areaName: string) => void;

const {
  showActionOverlayMock,
  storageChangeListeners,
  storageGetMock,
  storageOnChangedAddListenerMock,
  storageRemoveMock,
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
    storageRemoveMock: vi.fn(async () => undefined),
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
          remove: storageRemoveMock,
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
import { resetMediaPresenceForTests } from "../../../src/content/media-presence.js";

const DEFAULT_SETTINGS = defaults as ExtensionSettings;

// Vitest leaves Node's timers in place, so a timer the content script starts
// (a presence report, a cross-frame timeout, placeholder polling) outlives the
// test that started it, and can fire after the environment is torn down, when
// `window` no longer exists. After every test, leftover intervals are
// cancelled and leftover timeouts run at once rather than being dropped: the
// content script resets state in them (the pending presence report, a skip
// streak), and the next test must not inherit it.
type StartTimer = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
type StopTimer = (id?: number) => void;
type TimerStarters = typeof window.setTimeout & typeof window.setInterval;
type TimerStoppers = typeof window.clearTimeout & typeof window.clearInterval;

const MAX_TIMEOUT_FLUSH_ROUNDS = 10;
const MICROTASK_DRAIN_TURNS = 10;
const pendingTimeouts = new Map<number, () => void>();
const pendingIntervals = new Set<number>();
const startTimeout = window.setTimeout.bind(window) as StartTimer;
const startInterval = window.setInterval.bind(window) as StartTimer;
const stopTimeout = window.clearTimeout.bind(window) as StopTimer;
const stopInterval = window.clearInterval.bind(window) as StopTimer;

window.setTimeout = ((handler, timeout, ...args) => {
  const run = (): void => {
    pendingTimeouts.delete(id);
    if (typeof handler === "function") {
      (handler as (...handlerArgs: unknown[]) => void)(...args);
    }
  };
  const id = startTimeout(run, timeout);
  pendingTimeouts.set(id, run);
  return id;
}) as StartTimer as TimerStarters;

window.setInterval = ((...args) => {
  const id = startInterval(...args);
  pendingIntervals.add(id);
  return id;
}) as StartTimer as TimerStarters;

// Either function stops either kind of timer, in Node as in browsers.
function forgetAndStop(stop: StopTimer): StopTimer {
  return (id) => {
    if (id !== undefined) {
      pendingTimeouts.delete(id);
      pendingIntervals.delete(id);
    }
    stop(id);
  };
}

window.clearTimeout = forgetAndStop(stopTimeout) as TimerStoppers;
window.clearInterval = forgetAndStop(stopInterval) as TimerStoppers;

export async function settleLeftoverTimers(): Promise<void> {
  const clearPendingIntervals = (): void => {
    for (const id of pendingIntervals) {
      stopInterval(id);
    }
    pendingIntervals.clear();
  };

  const drainMicrotasks = async (): Promise<void> => {
    for (let turn = 0; turn < MICROTASK_DRAIN_TURNS; turn += 1) {
      await Promise.resolve();
    }
  };

  await drainMicrotasks();
  clearPendingIntervals();

  // A timeout or a chain of promise continuations it resumes may start another
  // timer, so drain microtasks between rounds, within reason.
  for (let round = 0; round < MAX_TIMEOUT_FLUSH_ROUNDS && pendingTimeouts.size > 0; round += 1) {
    for (const [id, run] of [...pendingTimeouts]) {
      // An earlier callback in this round may have cancelled this one.
      if (pendingTimeouts.has(id)) {
        stopTimeout(id);
        run();
      }
    }
    await drainMicrotasks();
    clearPendingIntervals();
  }

  for (const id of pendingTimeouts.keys()) {
    stopTimeout(id);
  }
  pendingTimeouts.clear();
}

afterEach(settleLeftoverTimers);

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

// jsdom has no text tracks, so give the video a list of its own. Like the real
// one it is array-like and fires `change` when a track's mode changes.
export function setTextTracks(video: HTMLVideoElement, tracks: object[]): EventTarget {
  const list = Object.assign(new EventTarget(), tracks);
  Object.defineProperty(list, "length", { value: tracks.length });
  Object.defineProperty(video, "textTracks", { configurable: true, value: list });
  return list;
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
  storageRemoveMock.mockReset();
  showActionOverlayMock.mockReset();
  setSettingsForTests(structuredClone(DEFAULT_SETTINGS));
  // The last reported presence decides whether the next report is sent, so a
  // test must not inherit the one its predecessor left.
  resetMediaPresenceForTests();
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

export { showActionOverlayMock, storageGetMock, storageRemoveMock, storageSetMock };
