import type { Page } from "@playwright/test";
import { expect, test } from "../setup.js";
import { createMedia } from "../fixtures.js";
import { openOverlayReader } from "../overlay.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

async function addTracks(
  page: Page,
  id: string,
  tracks: { kind: string; srclang: string; label: string }[],
): Promise<void> {
  await page.evaluate(
    ({ mediaId, trackList }) => {
      const video = document.getElementById(mediaId) as HTMLVideoElement;
      for (const { kind, srclang, label } of trackList) {
        const track = document.createElement("track");
        track.kind = kind;
        track.srclang = srclang;
        track.label = label;
        track.src = "/captions.vtt";
        video.appendChild(track);
      }
    },
    { mediaId: id, trackList: tracks },
  );
}

function readTrackModes(page: Page, id: string): Promise<string[]> {
  return page.evaluate(
    (mediaId) =>
      Array.from((document.getElementById(mediaId) as HTMLVideoElement).textTracks).map(
        (track) => track.mode,
      ),
    id,
  );
}

// Records, for each keydown the page sees, whether the extension took it.
async function recordPageKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: { key: string; defaultPrevented: boolean }[] = [];
    (window as typeof window & { __pageKeys: typeof seen }).__pageKeys = seen;
    window.addEventListener("keydown", (event) =>
      seen.push({ key: event.key, defaultPrevented: event.defaultPrevented }),
    );
  });
}

function readPageKeys(page: Page): Promise<{ key: string; defaultPrevented: boolean }[]> {
  return page.evaluate(
    () =>
      (window as typeof window & { __pageKeys: { key: string; defaultPrevented: boolean }[] })
        .__pageKeys,
  );
}

test("c toggles the caption track of the focused video and restores the last one shown", async ({
  page,
}) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "captioned", {}, "video");
  await addTracks(page, "captioned", [
    { kind: "chapters", srclang: "en", label: "Chapters" },
    { kind: "captions", srclang: "xx", label: "Original" },
    { kind: "subtitles", srclang: "fr", label: "Français" },
  ]);
  await page.locator("#captioned").focus();
  expect(await readTrackModes(page, "captioned")).toEqual(["disabled", "disabled", "disabled"]);

  await page.keyboard.press("c");

  await expect
    .poll(() => readTrackModes(page, "captioned"))
    .toEqual(["disabled", "showing", "disabled"]);
  await expect.poll(async () => (await overlay.read())?.text).toBe("Captions onOriginal");
  await expect
    .poll(async () => (await overlay.read())?.iconPath)
    .toContain("M200-160q-33 0-56.5-23.5");

  await page.keyboard.press("c");

  await expect
    .poll(() => readTrackModes(page, "captioned"))
    .toEqual(["disabled", "disabled", "disabled"]);
  await expect.poll(async () => (await overlay.read())?.text).toBe("Captions off");
  await expect.poll(async () => (await overlay.read())?.iconPath).toContain("M791-57 687-160");

  // The user picks another track in the player's own menu, then toggles.
  await page.evaluate(() => {
    (document.getElementById("captioned") as HTMLVideoElement).textTracks[2].mode = "showing";
  });
  await page.keyboard.press("c");
  await expect
    .poll(() => readTrackModes(page, "captioned"))
    .toEqual(["disabled", "disabled", "disabled"]);

  await page.keyboard.press("c");
  await expect
    .poll(() => readTrackModes(page, "captioned"))
    .toEqual(["disabled", "disabled", "showing"]);
  await expect.poll(async () => (await overlay.read())?.text).toBe("Captions onFrançais");
});

test("c restores a track the user picked in the player's menu and then turned off there", async ({
  page,
}) => {
  await createMedia(page, "captioned", {}, "video");
  await addTracks(page, "captioned", [
    { kind: "captions", srclang: "en", label: "English" },
    { kind: "captions", srclang: "fr", label: "French" },
  ]);
  await page.locator("#captioned").focus();
  await page.keyboard.press("c");
  await expect.poll(() => readTrackModes(page, "captioned")).toEqual(["showing", "disabled"]);

  await page.evaluate(async () => {
    const tracks = (document.getElementById("captioned") as HTMLVideoElement).textTracks;
    const nextChange = (): Promise<void> =>
      new Promise((resolve) => tracks.addEventListener("change", () => resolve(), { once: true }));
    let changed = nextChange();
    tracks[0].mode = "disabled";
    tracks[1].mode = "showing";
    await changed;
    changed = nextChange();
    tracks[1].mode = "disabled";
    await changed;
  });
  await page.keyboard.press("c");

  await expect.poll(() => readTrackModes(page, "captioned")).toEqual(["disabled", "showing"]);
});

test("c shows a track in the browser's language first", async ({ page }) => {
  await createMedia(page, "captioned", {}, "video");
  await addTracks(page, "captioned", [
    { kind: "captions", srclang: "fr", label: "French" },
    { kind: "captions", srclang: "en", label: "English" },
  ]);
  await page.locator("#captioned").focus();

  await page.keyboard.press("c");

  // The test browser's locale is English.
  await expect.poll(() => readTrackModes(page, "captioned")).toEqual(["disabled", "showing"]);
});

test("c reaches the page when the video has no caption track", async ({ page }) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "plain", {}, "video");
  await addTracks(page, "plain", [{ kind: "chapters", srclang: "en", label: "Chapters" }]);
  await page.locator("#plain").focus();
  await recordPageKeys(page);

  await page.keyboard.press("c");

  expect(await readPageKeys(page)).toEqual([{ key: "c", defaultPrevented: false }]);
  expect(await overlay.read()).toBeNull();
  expect(await readTrackModes(page, "plain")).toEqual(["disabled"]);
});

test("c reaches the page for a track the page reads cues from itself", async ({ page }) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "page-captions", {}, "video");
  await addTracks(page, "page-captions", [
    { kind: "captions", srclang: "en", label: "English" },
    { kind: "captions", srclang: "fr", label: "French" },
  ]);
  await page.evaluate(() => {
    (document.getElementById("page-captions") as HTMLVideoElement).textTracks[0].mode = "hidden";
  });
  await page.locator("#page-captions").focus();
  await recordPageKeys(page);

  await page.keyboard.press("c");

  expect(await readPageKeys(page)).toEqual([{ key: "c", defaultPrevented: false }]);
  expect(await overlay.read()).toBeNull();
  expect(await readTrackModes(page, "page-captions")).toEqual(["hidden", "disabled"]);
});

test("c works in theater mode when the video has captions and reaches the page when it has none", async ({
  page,
}) => {
  const overlay = await openOverlayReader(page);
  await createMedia(page, "theater-video", {}, "video");
  await addTracks(page, "theater-video", [{ kind: "captions", srclang: "en", label: "English" }]);
  await page.locator("#theater-video").focus();
  await page.keyboard.press("t");
  await expect
    .poll(() =>
      page.evaluate(() => document.getElementById("theater-video")!.matches(":popover-open")),
    )
    .toBe(true);

  await page.keyboard.press("c");

  await expect.poll(() => readTrackModes(page, "theater-video")).toEqual(["showing"]);
  await expect.poll(async () => (await overlay.read())?.text).toBe("Captions onEnglish");

  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.getElementById("theater-video")!.replaceChildren();
  });
  await page.keyboard.press("t");
  await recordPageKeys(page);

  await page.keyboard.press("c");

  expect(await readPageKeys(page)).toEqual([{ key: "c", defaultPrevented: false }]);
});

test("c reaches the page on a page without media", async ({ page }) => {
  await recordPageKeys(page);

  await page.keyboard.press("c");

  expect(await readPageKeys(page)).toEqual([{ key: "c", defaultPrevented: false }]);
});
