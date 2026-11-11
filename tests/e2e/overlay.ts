import type { CDPSession, Frame, Page } from "@playwright/test";

/**
 * The overlay's contents live in a closed shadow root, which page scripts (and
 * so Playwright locators and `page.evaluate`) can't see into. Only the content
 * script's isolated world can, through `chrome.dom.openOrClosedShadowRoot`, so
 * these helpers read the overlay from there over the DevTools protocol.
 */

export interface OverlaySnapshot {
  /** Whether the host is displayed (it is hidden once the overlay fades out). */
  visible: boolean;
  /** The text inside the shadow root, such as "0%" or "Overlays off". */
  text: string;
  /** The `d` attribute of the first icon path inside the shadow root, if any. */
  iconPath: string | null;
  /** What the page itself can see of the overlay's contents. */
  pageSees: { shadowRoot: boolean; text: string; descendants: number };
  /** The box inside the shadow root, as it is actually drawn. */
  box: {
    background: string;
    color: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    borderRadius: string;
    width: number;
    height: number;
  } | null;
  /** The host, as it is actually drawn. */
  host: {
    position: string;
    display: string;
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

type ContentScriptWorld = {
  id: number;
  name: string;
  auxData?: { type?: string; frameId?: string };
};

const SNAPSHOT_EXPRESSION = `(() => {
  const host = document.querySelector('#media-hotkeys-overlay[data-media-hotkeys-overlay="true"]');
  if (!host) return null;
  const root = chrome.dom.openOrClosedShadowRoot(host);
  const box = root && root.querySelector("div");
  const hostStyle = getComputedStyle(host);
  const hostRect = host.getBoundingClientRect();
  let boxSnapshot = null;
  if (box) {
    const style = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    boxSnapshot = {
      background: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      padding: style.padding,
      borderRadius: style.borderRadius,
      width: rect.width,
      height: rect.height,
    };
  }
  const path = root && root.querySelector("svg path");
  return {
    visible: hostStyle.display !== "none",
    text: box ? box.textContent : "",
    iconPath: path ? path.getAttribute("d") : null,
    pageSees: {
      shadowRoot: host.shadowRoot !== null,
      text: host.textContent,
      descendants: host.querySelectorAll("*").length,
    },
    box: boxSnapshot,
    host: {
      position: hostStyle.position,
      display: hostStyle.display,
      left: hostRect.left,
      top: hostRect.top,
      width: hostRect.width,
      height: hostRect.height,
    },
  };
})()`;

/**
 * Names a frame by the ids of the iframe elements leading to it, or "top". The
 * content script can only follow `frameElement` into same-origin frames, so the
 * helper supports only those, and every iframe on the way needs an id. It throws
 * when it can tell that two frames would share a name, but an unsupported frame
 * can also make `read` return null, so keep to same-origin frames with ids.
 */
async function frameSignature(frame: Frame): Promise<string> {
  const ids: string[] = [];
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement();
    const id = await element.getAttribute("id");
    if (!id) {
      throw new Error("openOverlayReader needs every iframe on the way to a frame to have an id");
    }
    ids.unshift(id);
  }
  return ids.join(">") || "top";
}

/**
 * Reads overlays from the content script of any frame of a page. Create it
 * once per page, before the overlay is shown.
 */
export async function openOverlayReader(page: Page): Promise<{
  read: (frame?: Frame) => Promise<OverlaySnapshot | null>;
}> {
  const session: CDPSession = await page.context().newCDPSession(page);
  let worlds: ContentScriptWorld[] = [];
  session.on("Runtime.executionContextCreated", ({ context }) => {
    worlds.push(context as ContentScriptWorld);
  });
  session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
    worlds = worlds.filter((world) => world.id !== executionContextId);
  });
  session.on("Runtime.executionContextsCleared", () => {
    worlds = [];
  });
  await session.send("Runtime.enable");

  const evaluate = async (world: ContentScriptWorld, expression: string): Promise<unknown> => {
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      contextId: world.id,
      expression,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  };

  // Content script worlds of the frames, keyed by the same signature as `frameSignature`.
  const worldsBySignature = async (): Promise<Map<string, ContentScriptWorld>> => {
    const bySignature = new Map<string, ContentScriptWorld>();
    const contentScriptWorlds = worlds.filter(
      (world) => world.auxData?.type === "isolated" && world.name === "Media Hotkeys",
    );
    for (const world of contentScriptWorlds) {
      try {
        const signature = await evaluate(
          world,
          `(() => {
            const ids = [];
            for (let win = window; win !== win.parent; win = win.parent) {
              ids.unshift(win.frameElement ? win.frameElement.id : "");
            }
            return ids.join(">") || "top";
          })()`,
        );
        if (bySignature.has(signature as string)) {
          throw new Error(
            `openOverlayReader found two content script worlds for the frame "${signature}"`,
          );
        }
        bySignature.set(signature as string, world);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("openOverlayReader")) {
          throw error;
        }
        // The frame navigated away while it was being read.
      }
    }
    return bySignature;
  };

  return {
    read: async (frame = page.mainFrame()) => {
      const world = (await worldsBySignature()).get(await frameSignature(frame));
      if (!world) {
        return null;
      }
      return (await evaluate(world, SNAPSHOT_EXPRESSION)) as OverlaySnapshot | null;
    },
  };
}
