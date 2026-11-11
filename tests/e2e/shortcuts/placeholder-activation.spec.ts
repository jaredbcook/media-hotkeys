import type { Page } from "@playwright/test";
import { expect, test } from "../setup.js";
import { readFrameMediaState, readMediaState } from "../fixtures.js";

test("activates a duration-less cued embed placeholder inside an iframe", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/page-with-cued-embed"));

  const frameHandle = await page.locator("#embed-frame").elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();
  await expect(frame!.locator("#cued-play")).toHaveCount(1);

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("k");

  await expect(frame!.locator("#cued-media")).toHaveCount(1);
  await expect
    .poll(async () => (await readFrameMediaState(frame!, "cued-media")).paused)
    .toBe(false);
});

test("activates a lite-youtube-style facade labeled only by visually hidden text", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/lite-facade"));

  await page.keyboard.press("k");

  await expect(page.locator("#facade-media")).toHaveCount(1);
  await expect.poll(async () => (await readMediaState(page, "facade-media")).paused).toBe(false);
});

test("does not navigate away by clicking a thumbnail card that links to another page", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/link-card-grid"));

  await page.keyboard.press("k");
  // Placeholder activation waits up to ~1s for media; give a navigation time to start.
  await page.waitForTimeout(1500);

  expect(new URL(page.url()).pathname).toBe("/link-card-grid");
  await expect(page.locator("#card")).toHaveCount(1);
});

type HostPlayerCounts = { play: number; pause: number };

/**
 * Adds a thumbnail placeholder whose click adds a custom element player. The
 * host keeps its own paused state, readable only through the player bridge, and
 * the inner element's playback is set apart from it.
 */
async function addHostPlayerPlaceholder(
  page: Page,
  { hostPaused, innerPlaying }: { hostPaused: boolean; innerPlaying: boolean },
): Promise<void> {
  await page.evaluate(
    ({ initialHostPaused, shouldPlayInner }) => {
      const counts = { play: 0, pause: 0 };
      (window as typeof window & { __hostPlayerCounts?: typeof counts }).__hostPlayerCounts =
        counts;

      class MediaHotkeysPlaceholderPlayer extends HTMLElement {
        private hostPaused = initialHostPaused;

        connectedCallback(): void {
          if (this.shadowRoot) {
            return;
          }

          const media = document.createElement("audio");
          media.id = "placeholder-host-media";
          media.src = "/silence.wav";
          media.preload = "auto";
          media.controls = true;
          media.loop = true;
          this.attachShadow({ mode: "open" }).appendChild(media);
          if (shouldPlayInner) {
            media.muted = true;
            void media.play();
          }
        }

        play(): Promise<void> {
          counts.play += 1;
          this.hostPaused = false;
          return Promise.resolve();
        }

        pause(): void {
          counts.pause += 1;
          this.hostPaused = true;
        }

        get paused(): boolean {
          return this.hostPaused;
        }
      }

      customElements.define("media-hotkeys-placeholder-player", MediaHotkeysPlaceholderPlayer);

      const app = document.getElementById("app");
      const placeholder = document.createElement("div");
      placeholder.id = "host-placeholder";
      placeholder.style.cssText =
        "position: relative; display: flex; align-items: center; justify-content: center;" +
        "width: 480px; height: 270px; cursor: pointer; background-image: linear-gradient(#333, #111);";
      const duration = document.createElement("div");
      duration.textContent = "1:01:17";
      duration.style.cssText = "position: absolute; right: 12px; bottom: 10px;";
      const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      playIcon.setAttribute("width", "64");
      playIcon.setAttribute("height", "46");
      playIcon.setAttribute("viewBox", "0 0 64 46");
      playIcon.innerHTML =
        '<path d="M0 0h64v46H0z" fill="#333"></path><path d="M42 23L25 13v20z" fill="#fff"></path>';
      placeholder.append(duration, playIcon);
      placeholder.addEventListener("click", () => {
        if (!document.querySelector("media-hotkeys-placeholder-player")) {
          app?.appendChild(document.createElement("media-hotkeys-placeholder-player"));
        }
      });
      app?.appendChild(placeholder);
    },
    { initialHostPaused: hostPaused, shouldPlayInner: innerPlaying },
  );
}

const readHostPlayerCounts = (page: Page): Promise<HostPlayerCounts | undefined> =>
  page.evaluate(
    () => (window as typeof window & { __hostPlayerCounts?: HostPlayerCounts }).__hostPlayerCounts,
  );

test("plays a placeholder's custom player when its host is paused although the inner media is playing", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/"));
  await addHostPlayerPlaceholder(page, { hostPaused: true, innerPlaying: true });

  await page.keyboard.press("k");

  await expect(page.locator("media-hotkeys-placeholder-player")).toHaveCount(1);
  await expect.poll(() => readHostPlayerCounts(page)).toEqual({ play: 1, pause: 0 });
});

test("does not play a placeholder's custom player again when its host is already playing", async ({
  page,
  server,
}) => {
  await page.goto(server.getUrl("/"));
  await addHostPlayerPlaceholder(page, { hostPaused: false, innerPlaying: false });

  await page.keyboard.press("k");
  await expect(page.locator("media-hotkeys-placeholder-player")).toHaveCount(1);

  // The player exists now, so the next press is an ordinary play/pause toggle.
  // The host is playing, so it pauses it. Once that has happened the first
  // press has long been decided, and it must not have played the host again.
  await page.keyboard.press("k");
  await expect.poll(() => readHostPlayerCounts(page)).toEqual({ play: 0, pause: 1 });
});
