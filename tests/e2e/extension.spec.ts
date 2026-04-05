import type { Frame, Page } from "@playwright/test";

import { expect, test } from "./setup";

type MediaState = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  muted: boolean;
  volume: number;
  currentTime: number;
  playbackRate: number;
  duration: number;
};

async function createMedia(
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

async function createEditable(
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

async function createShadowMedia(
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

async function readMediaState(page: Page, id: string): Promise<MediaState> {
  return page.evaluate((mediaId) => {
    return (
      window as typeof window & {
        __mediaFixtures: { readState: (id: string) => MediaState };
      }
    ).__mediaFixtures.readState(mediaId);
  }, id);
}

async function markPlaying(page: Page, id: string): Promise<void> {
  await page.evaluate((mediaId) => {
    (
      window as typeof window & {
        __mediaFixtures: { markPlaying: (id: string) => Promise<void> };
      }
    ).__mediaFixtures.markPlaying(mediaId);
  }, id);
}

async function markInteraction(page: Page, id: string): Promise<void> {
  await page.evaluate((mediaId) => {
    (
      window as typeof window & {
        __mediaFixtures: { markInteraction: (id: string) => void };
      }
    ).__mediaFixtures.markInteraction(mediaId);
  }, id);
}

async function waitForMediaState(
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

async function waitForMediaLoaded(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await readMediaState(page, id)).readyState).toBeGreaterThan(0);
}

async function readFrameMediaState(frame: Frame, id: string): Promise<MediaState> {
  return frame.evaluate((mediaId) => {
    return (
      window as typeof window & {
        __mediaFixtures: { readState: (id: string) => MediaState };
      }
    ).__mediaFixtures.readState(mediaId);
  }, id);
}

async function pressShiftedKey(page: Page, key: "," | "."): Promise<void> {
  const shortcut = key === "." ? "Shift+Period" : "Shift+Comma";
  await page.keyboard.press(shortcut);
}

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("toggles play/pause on a focused top-level media element", async ({ page }) => {
  await createMedia(page, "primary");
  await page.locator("#primary").focus();

  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => !state.paused);

  await page.keyboard.press("k");
  await waitForMediaState(page, "primary", (state) => state.paused);
});

test("toggles mute and adjusts seek, volume, and speed with default bindings", async ({ page }) => {
  await createMedia(page, "primary", {
    muted: false,
    volume: 0.5,
    playbackRate: 1,
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("m");
  await waitForMediaState(page, "primary", (state) => state.muted);

  await markPlaying(page, "primary");
  await waitForMediaState(page, "primary", (state) => !state.paused);
  const seekBaseline = (await readMediaState(page, "primary")).currentTime;
  await page.keyboard.press("ArrowRight");
  await waitForMediaState(page, "primary", (state) => state.currentTime >= seekBaseline + 4);

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.volume - 0.55) < 0.0001);

  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.volume - 0.5) < 0.0001);

  await pressShiftedKey(page, ".");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1.25) < 0.0001);

  await pressShiftedKey(page, ",");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1) < 0.0001);
});

test("prefers the focused media over a playing media element", async ({ page }) => {
  await createMedia(page, "first", { volume: 0.5 });
  await createMedia(page, "second", { volume: 0.8 });
  await markPlaying(page, "second");

  await page.locator("#first").focus();
  await page.keyboard.press("ArrowDown");

  await waitForMediaState(page, "first", (state) => Math.abs(state.volume - 0.45) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "second")).volume).toBeCloseTo(0.8, 5);
});

test("prefers playing media, then last interacted media, then the first media element", async ({
  page,
}) => {
  await createMedia(page, "first", { volume: 0.5 });
  await createMedia(page, "second", { volume: 0.8 });

  await markPlaying(page, "second");
  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "second", (state) => Math.abs(state.volume - 0.75) < 0.0001);
  await expect.poll(async () => (await readMediaState(page, "first")).volume).toBeCloseTo(0.5, 5);

  await page.evaluate(() => {
    const media = document.getElementById("second") as HTMLMediaElement | null;
    if (media) {
      media.pause();
    }
  });
  await markInteraction(page, "second");
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "second", (state) => Math.abs(state.volume - 0.7) < 0.0001);

  await page.evaluate(() => {
    const media = document.getElementById("second");
    media?.remove();
  });
  await page.keyboard.press("ArrowDown");
  await waitForMediaState(page, "first", (state) => Math.abs(state.volume - 0.45) < 0.0001);
});

test("suppresses hotkeys while typing in editable elements", async ({ page }) => {
  await createMedia(page, "primary");

  for (const kind of ["input", "textarea", "select", "contenteditable"] as const) {
    await createEditable(page, kind, kind);
    await page.locator(`#${kind}`).focus();
    await page.keyboard.press("k");
    await expect.poll(async () => (await readMediaState(page, "primary")).paused).toBe(true);
  }
});

test("delegates actions from the top window into a child iframe", async ({ page, server }) => {
  await page.goto(server.getUrl("/page-with-iframe"));

  const frameLocator = page.frameLocator("#child-frame");
  await expect(frameLocator.locator("#frame-media")).toHaveCount(1);
  const frameHandle = await page.locator("#child-frame").elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();

  await frame!.locator("#frame-media").press("k");
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "frame-media")).paused)
    .toBe(false);

  await frame!.evaluate(() => {
    const media = document.getElementById("frame-media") as HTMLMediaElement | null;
    media?.pause();
  });
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "frame-media")).paused)
    .toBe(true);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("k");
  await expect
    .poll(async () => {
      return (await readFrameMediaState(frame!, "frame-media")).paused;
    })
    .toBe(false);
});

test("controls media added in a shadow root after initialization", async ({ page }) => {
  await createShadowMedia(page, "shadow-host", "shadow-media", { muted: false });

  await page.keyboard.press("m");
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const host = document.getElementById("shadow-host");
        const media = host?.shadowRoot?.getElementById("shadow-media");
        return (
          window as typeof window & {
            __mediaFixtures: { readState: (id: string) => MediaState };
          }
        ).__mediaFixtures.readState((media as HTMLMediaElement).id).muted;
      });
    })
    .toBe(true);
});

test("controls media added dynamically after page load", async ({ page }) => {
  await createMedia(page, "late-media");

  await page.keyboard.press("k");
  await waitForMediaState(page, "late-media", (state) => !state.paused);
});
