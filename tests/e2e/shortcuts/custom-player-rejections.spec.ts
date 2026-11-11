import { expect, test } from "../setup.js";

test.beforeEach(async ({ page, server }) => {
  await page.goto(server.getUrl("/"));
});

test("refused host methods of a custom player leave no unhandled rejection", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.evaluate(() => {
    const calls = { play: 0, pause: 0, requestFullscreen: 0 };
    const unhandled: string[] = [];
    const state = window as typeof window & {
      __refusingPlayerCalls?: typeof calls;
      __unhandledRejections?: string[];
    };
    state.__refusingPlayerCalls = calls;
    state.__unhandledRejections = unhandled;
    window.addEventListener("unhandledrejection", (event) => {
      unhandled.push(String(event.reason));
    });

    // A player that starts and stops playback but refuses every promise it returns,
    // as a host does when the browser denies fullscreen or its own backend fails.
    class MediaHotkeysRefusingPlayer extends HTMLElement {
      private hostPaused = true;

      connectedCallback(): void {
        if (this.shadowRoot) {
          return;
        }

        const media = document.createElement("video");
        media.id = "refusing-media";
        media.src = "/silence.wav";
        media.preload = "auto";
        media.controls = true;
        media.tabIndex = 0;
        this.attachShadow({ mode: "open" }).appendChild(media);
      }

      get paused(): boolean {
        return this.hostPaused;
      }

      play(): Promise<void> {
        calls.play += 1;
        this.hostPaused = false;
        return Promise.reject(new Error("play refused"));
      }

      pause(): Promise<void> {
        calls.pause += 1;
        this.hostPaused = true;
        return Promise.reject(new Error("pause refused"));
      }

      requestFullscreen(): Promise<void> {
        calls.requestFullscreen += 1;
        return Promise.reject(new Error("fullscreen refused"));
      }
    }

    customElements.define("media-hotkeys-refusing-player", MediaHotkeysRefusingPlayer);
    const host = document.createElement("media-hotkeys-refusing-player");
    host.id = "refusing-host";
    document.getElementById("app")?.appendChild(host);
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById("refusing-host");
        const media = host?.shadowRoot?.getElementById("refusing-media") as HTMLMediaElement | null;
        return media?.readyState ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const host = document.getElementById("refusing-host");
    (host?.shadowRoot?.getElementById("refusing-media") as HTMLMediaElement).focus();
  });

  await page.keyboard.press("k");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __refusingPlayerCalls?: { play: number } })
            .__refusingPlayerCalls?.play,
      ),
    )
    .toBe(1);

  await page.keyboard.press("k");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __refusingPlayerCalls?: { pause: number } })
            .__refusingPlayerCalls?.pause,
      ),
    )
    .toBe(1);

  await page.keyboard.press("f");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __refusingPlayerCalls?: { requestFullscreen: number } })
            .__refusingPlayerCalls?.requestFullscreen,
      ),
    )
    .toBe(1);

  // Unhandled rejections are reported once the microtask queue has drained, so
  // let a few frames pass before asserting there were none.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(
    await page.evaluate(
      () => (window as typeof window & { __unhandledRejections?: string[] }).__unhandledRejections,
    ),
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
});
