import { test as base, chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import http from "http";
import path from "path";

type ServerRoute = {
  contentType?: string;
  body: Buffer | string;
};

type TestServer = {
  url: string;
  getUrl: (pathname: string) => string;
};

const extensionPath = path.resolve("dist/chrome");

function createFixturePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body {
        font-family: sans-serif;
        padding: 24px;
      }

      #app {
        display: grid;
        gap: 16px;
      }

      video,
      audio,
      iframe,
      input,
      textarea,
      select,
      [contenteditable="true"] {
        display: block;
      }

      video,
      audio {
        width: 320px;
        height: 180px;
        background: #222;
      }

      [contenteditable="true"] {
        border: 1px solid #999;
        min-height: 40px;
        padding: 8px;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      function findMediaById(id, root = document) {
        const directMatch = root.getElementById?.(id);
        if (directMatch instanceof HTMLMediaElement) {
          return directMatch;
        }

        const walker = document.createTreeWalker(
          root === document ? document.documentElement : root,
          NodeFilter.SHOW_ELEMENT,
        );

        let node = walker.currentNode;
        while (node) {
          if (node instanceof Element && node.shadowRoot) {
            const nestedMatch = findMediaById(id, node.shadowRoot);
            if (nestedMatch) {
              return nestedMatch;
            }
          }
          node = walker.nextNode();
        }

        return null;
      }

      function applyMediaDefaults(media, overrides = {}) {
        media.src = "/silence.wav";
        media.preload = "auto";
        media.tabIndex = 0;
        media.volume = 0.5;
        media.currentTime = 0;
        media.playbackRate = 1;

        for (const [key, value] of Object.entries(overrides)) {
          media[key] = value;
        }

        return media;
      }

      window.__mediaFixtures = {
        createMedia(id, tagName = "audio", overrides = {}) {
          const media = document.createElement(tagName);
          media.id = id;
          document.getElementById("app").appendChild(media);
          return applyMediaDefaults(media, overrides);
        },
        createEditable(kind, id) {
          const app = document.getElementById("app");
          let element;

          if (kind === "contenteditable") {
            element = document.createElement("div");
            element.contentEditable = "true";
            element.textContent = "editable";
          } else {
            element = document.createElement(kind);
            if (kind === "select") {
              const option = document.createElement("option");
              option.value = "1";
              option.textContent = "Option";
              element.appendChild(option);
            }
          }

          element.id = id;
          app.appendChild(element);
          return element;
        },
        createShadowMedia(hostId, mediaId, overrides = {}) {
          const host = document.createElement("div");
          host.id = hostId;
          document.getElementById("app").appendChild(host);
          const shadowRoot = host.attachShadow({ mode: "open" });
          const media = document.createElement("audio");
          media.id = mediaId;
          shadowRoot.appendChild(media);
          return applyMediaDefaults(media, overrides);
        },
        async markPlaying(id) {
          const media = findMediaById(id);
          if (!media) {
            throw new Error("Unknown media: " + id);
          }
          media.muted = true;
          await media.play();
        },
        markInteraction(id) {
          const media = findMediaById(id);
          if (!media) {
            throw new Error("Unknown media: " + id);
          }
          media.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        readState(id) {
          const media = findMediaById(id);
          if (!media) {
            throw new Error("Unknown media: " + id);
          }
          return {
            paused: media.paused,
            ended: media.ended,
            readyState: media.readyState,
            muted: media.muted,
            volume: media.volume,
            currentTime: media.currentTime,
            playbackRate: media.playbackRate,
            duration: media.duration,
          };
        },
      };
    </script>
    ${body}
  </body>
</html>`;
}

function createSilentWavBuffer(durationSeconds: number, sampleRate = 8000): Buffer {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = durationSeconds * sampleRate * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function createServer(
  routes: Record<string, ServerRoute>,
): Promise<http.Server & { baseUrl: string }> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const route = routes[pathname];

    if (!route) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": route.contentType ?? "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(route.body);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine test server address"));
        return;
      }

      resolve(Object.assign(server, { baseUrl: `http://127.0.0.1:${address.port}` }));
    });
    server.on("error", reject);
  });
}

type Fixtures = {
  context: BrowserContext;
  page: Page;
  server: TestServer;
};

export const test = base.extend<Fixtures>({
  // Playwright fixture callbacks require destructured first params.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },

  // Playwright fixture callbacks require destructured first params.
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await createServer({
      "/": {
        body: createFixturePage("Media Hotkeys E2E", ""),
      },
      "/shorts": {
        body: createFixturePage("Media Hotkeys E2E Shorts", ""),
      },
      "/watch": {
        body: createFixturePage("Media Hotkeys E2E Watch", ""),
      },
      "/silence.wav": {
        contentType: "audio/wav",
        body: createSilentWavBuffer(12),
      },
      "/iframe-media": {
        body: createFixturePage(
          "Iframe Media",
          `<script>
            window.addEventListener("DOMContentLoaded", () => {
              window.__mediaFixtures.createMedia("frame-media");
            });
          </script>`,
        ),
      },
      "/page-with-iframe": {
        body: createFixturePage(
          "Page With Iframe",
          `<iframe id="child-frame" src="/iframe-media"></iframe>`,
        ),
      },
    });

    await use({
      url: server.baseUrl,
      getUrl: (pathname: string) => new URL(pathname, server.baseUrl).toString(),
    });

    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  },
});

export { expect };
