import { expect, test } from "../setup.js";
import {
  createMedia,
  markPlaying,
  pressShiftedKey,
  readMediaState,
  waitForMediaState,
} from "../fixtures.js";

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

test("activates a video placeholder before controlling the injected media", async ({ page }) => {
  await page.evaluate(() => {
    const app = document.getElementById("app");
    const placeholder = document.createElement("div");
    placeholder.id = "video-placeholder";
    placeholder.style.position = "relative";
    placeholder.style.alignItems = "center";
    placeholder.style.backgroundImage = "linear-gradient(#333, #111)";
    placeholder.style.cursor = "pointer";
    placeholder.style.display = "flex";
    placeholder.style.height = "270px";
    placeholder.style.justifyContent = "center";
    placeholder.style.width = "480px";

    const duration = document.createElement("div");
    duration.textContent = "1:01:17";
    duration.style.position = "absolute";
    duration.style.right = "12px";
    duration.style.bottom = "10px";

    const playIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    playIcon.setAttribute("width", "64");
    playIcon.setAttribute("height", "46");
    playIcon.setAttribute("viewBox", "0 0 64 46");
    playIcon.innerHTML =
      '<path d="M0 0h64v46H0z" fill="#333"></path><path d="M42 23L25 13v20z" fill="#fff"></path>';

    placeholder.append(duration, playIcon);
    placeholder.addEventListener("click", () => {
      if (document.getElementById("placeholder-video")) {
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 18;
      const context = canvas.getContext("2d");
      context!.fillStyle = "#111";
      context!.fillRect(0, 0, canvas.width, canvas.height);

      const video = document.createElement("video");
      video.id = "placeholder-video";
      video.controls = true;
      video.muted = true;
      video.srcObject = canvas.captureStream(1);
      app?.appendChild(video);
    });

    app?.appendChild(placeholder);
  });

  await page.keyboard.press("k");
  await waitForMediaState(page, "placeholder-video", (state) => !state.paused);

  await page.keyboard.press("k");
  await waitForMediaState(page, "placeholder-video", (state) => state.paused);
});

test("plays media inside a custom element shadow root via a play button fallback", async ({
  page,
}) => {
  await page.evaluate(() => {
    const app = document.getElementById("app");
    const host = document.createElement("custom-player");
    host.id = "custom-player-host";
    const shadowRoot = host.attachShadow({ mode: "open" });
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.setAttribute("aria-label", "Play media");
    playButton.innerText = "Play media";
    const media = document.createElement("audio");
    media.id = "custom-player-media";
    shadowRoot.appendChild(playButton);
    shadowRoot.appendChild(media);
    app?.appendChild(host);

    media.src = "/silence.wav";
    media.preload = "auto";
    media.tabIndex = 0;
    media.volume = 0.5;
    media.currentTime = 0;
    media.playbackRate = 1;

    (
      window as typeof window & {
        __customPlayerPlayButtonClicks?: number;
      }
    ).__customPlayerPlayButtonClicks = 0;

    playButton.addEventListener("click", () => {
      (
        window as typeof window & {
          __customPlayerPlayButtonClicks?: number;
        }
      ).__customPlayerPlayButtonClicks =
        ((
          window as typeof window & {
            __customPlayerPlayButtonClicks?: number;
          }
        ).__customPlayerPlayButtonClicks ?? 0) + 1;
      void media.play();
    });
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById("custom-player-host");
        const media = host?.shadowRoot?.getElementById(
          "custom-player-media",
        ) as HTMLMediaElement | null;
        return media?.readyState ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("k");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById("custom-player-host");
        const media = host?.shadowRoot?.getElementById(
          "custom-player-media",
        ) as HTMLMediaElement | null;
        return {
          paused: media?.paused ?? true,
          playButtonClicks:
            (
              window as typeof window & {
                __customPlayerPlayButtonClicks?: number;
              }
            ).__customPlayerPlayButtonClicks ?? 0,
        };
      }),
    )
    .toEqual({
      paused: false,
      playButtonClicks: 1,
    });
});

test("uses custom element host APIs for shadow-root media actions", async ({ page }) => {
  await page.evaluate(() => {
    const counts = {
      play: 0,
      pause: 0,
      muted: 0,
      volume: 0,
      currentTime: 0,
      playbackRate: 0,
      fullscreen: 0,
    };
    (
      window as typeof window & {
        __customPlayerApiCounts?: typeof counts;
      }
    ).__customPlayerApiCounts = counts;

    class MediaHotkeysTestPlayer extends HTMLElement {
      connectedCallback(): void {
        if (this.shadowRoot) {
          return;
        }

        const shadowRoot = this.attachShadow({ mode: "open" });
        const media = document.createElement("audio");
        media.id = "custom-api-media";
        media.src = "/silence.wav";
        media.preload = "auto";
        media.tabIndex = 0;
        media.volume = 0.5;
        media.currentTime = 0;
        media.playbackRate = 1;
        shadowRoot.appendChild(media);
      }

      get media(): HTMLMediaElement {
        const media = this.shadowRoot?.getElementById("custom-api-media");
        if (!(media instanceof HTMLMediaElement)) {
          throw new Error("Missing custom player media");
        }
        return media;
      }

      play(): Promise<void> {
        counts.play += 1;
        return this.media.play();
      }

      pause(): void {
        counts.pause += 1;
        this.media.pause();
      }

      get muted(): boolean {
        return this.media.muted;
      }

      set muted(value: boolean) {
        counts.muted += 1;
        this.media.muted = value;
      }

      get volume(): number {
        return this.media.volume;
      }

      set volume(value: number) {
        counts.volume += 1;
        this.media.volume = value;
      }

      get currentTime(): number {
        return this.media.currentTime;
      }

      set currentTime(value: number) {
        counts.currentTime += 1;
        this.media.currentTime = value;
      }

      get duration(): number {
        return this.media.duration;
      }

      get playbackRate(): number {
        return this.media.playbackRate;
      }

      set playbackRate(value: number) {
        counts.playbackRate += 1;
        this.media.playbackRate = value;
      }

      requestFullscreen(): Promise<void> {
        counts.fullscreen += 1;
        return HTMLElement.prototype.requestFullscreen.call(this);
      }
    }

    if (!customElements.get("media-hotkeys-test-player")) {
      customElements.define("media-hotkeys-test-player", MediaHotkeysTestPlayer);
    }

    const host = document.createElement("media-hotkeys-test-player");
    host.id = "custom-api-host";
    document.getElementById("app")?.appendChild(host);
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById("custom-api-host");
        const media = host?.shadowRoot?.getElementById(
          "custom-api-media",
        ) as HTMLMediaElement | null;
        return media?.readyState ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("k");
  await waitForMediaState(page, "custom-api-media", (state) => !state.paused);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __customPlayerApiCounts?: { play: number };
            }
          ).__customPlayerApiCounts?.play ?? 0,
      ),
    )
    .toBe(1);

  await page.keyboard.press("k");
  await waitForMediaState(page, "custom-api-media", (state) => state.paused);

  await page.keyboard.press("m");
  await waitForMediaState(page, "custom-api-media", (state) => state.muted);

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(
    page,
    "custom-api-media",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );

  await markPlaying(page, "custom-api-media");
  await waitForMediaState(page, "custom-api-media", (state) => !state.paused);
  const seekBaseline = (await readMediaState(page, "custom-api-media")).currentTime;
  await page.keyboard.press("ArrowRight");
  await waitForMediaState(
    page,
    "custom-api-media",
    (state) => state.currentTime >= seekBaseline + 4,
  );

  await pressShiftedKey(page, ".");
  await waitForMediaState(
    page,
    "custom-api-media",
    (state) => Math.abs(state.playbackRate - 1.25) < 0.0001,
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        return (
          window as typeof window & {
            __customPlayerApiCounts?: Record<string, number>;
          }
        ).__customPlayerApiCounts;
      }),
    )
    .toMatchObject({
      pause: 1,
      muted: 2,
      volume: 1,
      currentTime: 1,
      playbackRate: 1,
    });
});

test("uses a custom element host fullscreen API for shadow-root video", async ({ page }) => {
  await page.evaluate(() => {
    const counts = {
      fullscreen: 0,
    };
    (
      window as typeof window & {
        __customPlayerFullscreenCounts?: typeof counts;
      }
    ).__customPlayerFullscreenCounts = counts;

    class MediaHotkeysFullscreenPlayer extends HTMLElement {
      connectedCallback(): void {
        if (this.shadowRoot) {
          return;
        }

        const shadowRoot = this.attachShadow({ mode: "open" });
        const media = document.createElement("video");
        media.id = "custom-fullscreen-video";
        media.src = "/silence.wav";
        media.controls = true;
        media.tabIndex = 0;
        shadowRoot.appendChild(media);
      }

      requestFullscreen(): Promise<void> {
        counts.fullscreen += 1;
        return HTMLElement.prototype.requestFullscreen.call(this);
      }
    }

    if (!customElements.get("media-hotkeys-fullscreen-player")) {
      customElements.define("media-hotkeys-fullscreen-player", MediaHotkeysFullscreenPlayer);
    }

    const host = document.createElement("media-hotkeys-fullscreen-player");
    host.id = "custom-fullscreen-host";
    document.getElementById("app")?.appendChild(host);
  });

  await page.keyboard.press("f");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById("custom-fullscreen-host");
        return {
          fullscreenCount:
            (
              window as typeof window & {
                __customPlayerFullscreenCounts?: { fullscreen: number };
              }
            ).__customPlayerFullscreenCounts?.fullscreen ?? 0,
          hostIsFullscreen: document.fullscreenElement === host,
        };
      }),
    )
    .toEqual({
      fullscreenCount: 1,
      hostIsFullscreen: true,
    });
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
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );

  await page.keyboard.press("ArrowDown");
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0) < 0.0001,
  );

  await page.keyboard.press("ArrowUp");
  await waitForMediaState(
    page,
    "primary",
    (state) => !state.muted && Math.abs(state.volume - 0.05) < 0.0001,
  );

  await page.keyboard.press("m");
  await waitForMediaState(page, "primary", (state) => state.muted);

  await pressShiftedKey(page, ".");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1.25) < 0.0001);

  await pressShiftedKey(page, ",");
  await waitForMediaState(page, "primary", (state) => Math.abs(state.playbackRate - 1) < 0.0001);
});

test("restarts media with the default binding", async ({ page }) => {
  await createMedia(page, "primary", {
    currentTime: 25,
    duration: 100,
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("r");
  await waitForMediaState(page, "primary", (state) => state.currentTime === 0);
});

test("shows overlays while a video is fullscreen", async ({ page }) => {
  await page.evaluate(() => {
    (
      window as typeof window & {
        __mediaFixtures: {
          createMedia: (id: string, tagName?: string, overrides?: Record<string, unknown>) => void;
        };
      }
    ).__mediaFixtures.createMedia("primary", "video");
  });
  await page.locator("#primary").focus();

  await page.keyboard.press("f");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const video = document.getElementById("primary");
        return Boolean(video && document.fullscreenElement?.contains(video));
      }),
    )
    .toBe(true);

  await page.keyboard.press("m");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.getElementById("media-shortcuts-overlay");
        const parent = overlay?.parentElement;
        return {
          display: overlay ? getComputedStyle(overlay).display : "none",
          parentIsFullscreenHost: parent === document.fullscreenElement,
        };
      }),
    )
    .toEqual({
      display: "flex",
      parentIsFullscreenHost: true,
    });
});
