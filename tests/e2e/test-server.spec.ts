import { expect, test } from "./setup.js";
import { createMedia, readMediaState } from "./fixtures.js";

// Chrome can only seek media from a server that honors byte ranges. Tests that
// press a seek key and wait for the time to move would otherwise pass only
// because the media keeps playing, which is a race against their own timeout.
test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("serves media that can be seeked", async ({ page }) => {
  await createMedia(page, "primary");
  await page.evaluate(() => {
    (document.getElementById("primary") as HTMLMediaElement).currentTime = 6;
  });

  // The media is paused, so only a real seek can move the time.
  await expect.poll(async () => (await readMediaState(page, "primary")).currentTime).toBe(6);
});

test("answers byte range requests like a static file server", async ({ page }) => {
  const responses = await page.evaluate(async () => {
    const read = async (range?: string, method = "GET") => {
      const response = await fetch("/silence.wav", {
        method,
        headers: range ? { Range: range } : {},
      });
      return {
        status: response.status,
        acceptRanges: response.headers.get("Accept-Ranges"),
        contentRange: response.headers.get("Content-Range"),
        length: (await response.arrayBuffer()).byteLength,
      };
    };

    return {
      whole: await read(),
      first: await read("bytes=0-9"),
      open: await read("bytes=192000-"),
      suffix: await read("bytes=-4"),
      beyond: await read("bytes=999999-"),
      // Ranges the server doesn't handle get the whole body, as RFC 9110 allows.
      several: await read("bytes=0-1,4-5"),
      malformed: await read("bytes=a-b"),
      head: await read("bytes=0-9", "HEAD"),
    };
  });

  // 12 s of 8 kHz 16-bit mono audio (192000 bytes) plus a 44-byte header.
  const size = 192044;
  expect(responses.whole).toMatchObject({ status: 200, acceptRanges: "bytes", length: size });
  expect(responses.first).toMatchObject({
    status: 206,
    contentRange: `bytes 0-9/${size}`,
    length: 10,
  });
  expect(responses.open).toMatchObject({
    status: 206,
    contentRange: `bytes 192000-${size - 1}/${size}`,
    length: 44,
  });
  expect(responses.suffix).toMatchObject({
    status: 206,
    contentRange: `bytes ${size - 4}-${size - 1}/${size}`,
    length: 4,
  });
  expect(responses.beyond).toMatchObject({ status: 416, contentRange: `bytes */${size}` });
  expect(responses.several).toMatchObject({ status: 200, contentRange: null, length: size });
  expect(responses.malformed).toMatchObject({ status: 200, contentRange: null, length: size });
  // A HEAD request has no body, and a range doesn't turn it into a 206.
  expect(responses.head).toMatchObject({ status: 200, contentRange: null, length: 0 });
});
