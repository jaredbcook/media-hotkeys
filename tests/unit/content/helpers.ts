import { vi } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { ExtensionSettings } from "../../../src/storage.js";

const { showActionOverlayMock, storageGetMock, storageSetMock } = vi.hoisted(() => ({
  showActionOverlayMock: vi.fn(),
  storageGetMock: vi.fn(async (defaults: Record<string, unknown>) => defaults),
  storageSetMock: vi.fn(async () => undefined),
}));

vi.mock("webextension-polyfill", () => {
  return {
    default: {
      storage: {
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

export function resetContentTestState(): void {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  showActionOverlayMock.mockReset();
  setSettingsForTests(structuredClone(DEFAULT_SETTINGS));
}

export async function dispatchMappedKey(key: string, init?: KeyboardEventInit): Promise<void> {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  await Promise.resolve();
}

export { showActionOverlayMock, storageSetMock };
