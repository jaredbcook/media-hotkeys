import type { Frame, Page } from "@playwright/test";
import { expect } from "./setup.js";

export type MediaState = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  muted: boolean;
  volume: number;
  currentTime: number;
  playbackRate: number;
  duration: number;
};

export async function createMedia(
  page: Page,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    ({ mediaId, mediaOverrides }) => {
      (
        window as typeof window & {
          __mediaFixtures: {
            createMedia: (
              id: string,
              tagName?: string,
              overrides?: Record<string, unknown>,
            ) => void;
          };
        }
      ).__mediaFixtures.createMedia(mediaId, undefined, mediaOverrides);
    },
    { mediaId: id, mediaOverrides: overrides },
  );
  await waitForMediaLoaded(page, id);
}

export async function createEditable(
  page: Page,
  kind: "input" | "textarea" | "select" | "contenteditable",
  id: string,
): Promise<void> {
  await page.evaluate(
    ({ editableKind, editableId }) => {
      (
        window as typeof window & {
          __mediaFixtures: {
            createEditable: (
              kind: "input" | "textarea" | "select" | "contenteditable",
              id: string,
            ) => HTMLElement;
          };
        }
      ).__mediaFixtures.createEditable(editableKind, editableId);
    },
    { editableKind: kind, editableId: id },
  );
}

export async function createShadowMedia(
  page: Page,
  hostId: string,
  mediaId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    ({ shadowHostId, shadowMediaId, mediaOverrides }) => {
      (
        window as typeof window & {
          __mediaFixtures: {
            createShadowMedia: (
              hostId: string,
              mediaId: string,
              overrides?: Record<string, unknown>,
            ) => void;
          };
        }
      ).__mediaFixtures.createShadowMedia(shadowHostId, shadowMediaId, mediaOverrides);
    },
    { shadowHostId: hostId, shadowMediaId: mediaId, mediaOverrides: overrides },
  );
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ currentHostId, currentMediaId }) => {
          const host = document.getElementById(currentHostId);
          const media = host?.shadowRoot?.getElementById(currentMediaId) as HTMLMediaElement | null;
          return media?.readyState ?? 0;
        },
        { currentHostId: hostId, currentMediaId: mediaId },
      );
    })
    .toBeGreaterThan(0);
}

export async function readMediaState(page: Page, id: string): Promise<MediaState> {
  return page.evaluate((mediaId) => {
    return (
      window as typeof window & {
        __mediaFixtures: { readState: (id: string) => MediaState };
      }
    ).__mediaFixtures.readState(mediaId);
  }, id);
}

export async function markPlaying(page: Page, id: string): Promise<void> {
  await page.evaluate((mediaId) => {
    (
      window as typeof window & {
        __mediaFixtures: { markPlaying: (id: string) => Promise<void> };
      }
    ).__mediaFixtures.markPlaying(mediaId);
  }, id);
}

export async function markInteraction(page: Page, id: string): Promise<void> {
  await page.evaluate((mediaId) => {
    (
      window as typeof window & {
        __mediaFixtures: { markInteraction: (id: string) => void };
      }
    ).__mediaFixtures.markInteraction(mediaId);
  }, id);
}

export async function waitForMediaState(
  page: Page,
  id: string,
  predicate: (state: MediaState) => boolean,
): Promise<void> {
  await expect
    .poll(async () => {
      const state = await readMediaState(page, id);
      return predicate(state);
    })
    .toBe(true);
}

export async function waitForMediaLoaded(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await readMediaState(page, id)).readyState).toBeGreaterThan(0);
}

export async function readFrameMediaState(frame: Frame, id: string): Promise<MediaState> {
  return frame.evaluate((mediaId) => {
    return (
      window as typeof window & {
        __mediaFixtures: { readState: (id: string) => MediaState };
      }
    ).__mediaFixtures.readState(mediaId);
  }, id);
}

export async function pressShiftedKey(page: Page, key: "," | "."): Promise<void> {
  const shortcut = key === "." ? "Shift+Period" : "Shift+Comma";
  await page.keyboard.press(shortcut);
}
