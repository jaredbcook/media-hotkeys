import { MESSAGE_SOURCE, THEATER_ATTR, THEATER_STYLE_ATTR, THEATER_TYPE } from "./constants.js";
import { debugLog } from "./dom-utils.js";

type TheaterElement = HTMLVideoElement | HTMLIFrameElement;

type TheaterSession = {
  element: TheaterElement;
  // Set when the promoted element is an iframe whose own frame is in theater
  // mode; exits are forwarded to it so both levels unwind together.
  childWindow: Window | null;
  previousPopover: string | null;
  addedControls: boolean;
  scrollX: number;
  scrollY: number;
  observer: MutationObserver;
};

export type FrameTheaterMessage = {
  source: "media-shortcuts-extension";
  type: "MEDIA_HOTKEYS_THEATER";
  active: boolean;
  // Present on promotion requests: the execute requestId the parent routed
  // toggleTheater under, which the parent checks before enlarging the iframe.
  requestId?: string;
};

let activeSession: TheaterSession | null = null;

// Theater mode promotes the video itself into the browser's top layer as a
// manual popover instead of moving it into a dialog. The element keeps its DOM
// position, so site scripts, framework reconcilers, and player wrappers that
// hold references to it keep working, while the top layer escapes ancestor
// transforms, overflow clipping, and stacking contexts. Rules are !important in
// a cascade layer so they also beat unlayered !important site styles and
// non-important inline sizes written by player scripts on resize. When the
// video lives in an iframe, each ancestor frame promotes the iframe hosting it
// the same way so the video can fill the top-level viewport.
const THEATER_STYLES = `
  @layer media-hotkeys-theater {
    :is(video, iframe)[${THEATER_ATTR}="true"]:popover-open {
      background: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-sizing: border-box !important;
      clip-path: none !important;
      display: block !important;
      filter: none !important;
      height: 100% !important;
      inset: 0 !important;
      margin: 0 !important;
      max-height: none !important;
      max-width: none !important;
      min-height: 0 !important;
      min-width: 0 !important;
      object-fit: contain !important;
      object-position: center !important;
      opacity: 1 !important;
      padding: 0 !important;
      pointer-events: auto !important;
      position: fixed !important;
      rotate: none !important;
      scale: none !important;
      transform: none !important;
      translate: none !important;
      visibility: visible !important;
      width: 100% !important;
    }

    :is(video, iframe)[${THEATER_ATTR}="true"]::backdrop {
      background: rgba(0, 0, 0, 0.9) !important;
    }
  }
`;

export function isPopoverSupported(): boolean {
  return typeof HTMLElement.prototype.showPopover === "function";
}

function isPopoverOpen(element: Element): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

function postTheaterMessage(target: Window, active: boolean, requestId?: string): void {
  const message: FrameTheaterMessage = {
    source: MESSAGE_SOURCE,
    type: THEATER_TYPE,
    active,
    ...(requestId ? { requestId } : {}),
  };

  try {
    target.postMessage(message, "*");
  } catch {
    // The frame may have navigated away; nothing left to notify.
  }
}

function ensureTheaterStyles(element: TheaterElement): void {
  const root = element.getRootNode();
  const styleParent = root instanceof ShadowRoot ? root : document.head;
  if (styleParent.querySelector(`style[${THEATER_STYLE_ATTR}="true"]`)) {
    return;
  }

  const style = document.createElement("style");
  style.setAttribute(THEATER_STYLE_ATTR, "true");
  style.textContent = THEATER_STYLES;
  styleParent.appendChild(style);
}

function restoreElement(session: TheaterSession): void {
  const { element } = session;
  if (isPopoverOpen(element)) {
    element.hidePopover();
  }

  if (session.previousPopover === null) {
    element.removeAttribute("popover");
  } else {
    element.setAttribute("popover", session.previousPopover);
  }

  element.removeAttribute(THEATER_ATTR);
  if (session.addedControls && element instanceof HTMLVideoElement) {
    element.controls = false;
  }
}

function handleTheaterToggle(event: Event): void {
  if ((event as ToggleEvent).newState === "closed") {
    exitTheater();
  }
}

// A navigation inside a promoted iframe discards the child's theater state.
function handleTheaterFrameLoad(): void {
  exitTheater();
}

/**
 * Returns the element currently in theater mode in this frame. Clears stale
 * state when the page removed the element or closed its popover behind the
 * extension's back (removal hides a popover without firing a toggle event).
 */
function getTheaterElement(): TheaterElement | null {
  if (!activeSession) {
    return null;
  }

  if (!activeSession.element.isConnected || !isPopoverOpen(activeSession.element)) {
    exitTheater({ restoreScroll: false });
    return null;
  }

  return activeSession.element;
}

export function getTheaterMedia(): HTMLVideoElement | null {
  const element = getTheaterElement();
  return element instanceof HTMLVideoElement ? element : null;
}

export function isTheaterMedia(media: HTMLMediaElement): boolean {
  return activeSession?.element === media && media.hasAttribute(THEATER_ATTR);
}

function promote(element: TheaterElement, childWindow: Window | null): boolean {
  if (activeSession?.element === element) {
    return true;
  }

  exitTheater();

  if (!isPopoverSupported() || document.fullscreenElement || !element.isConnected) {
    debugLog("Theater mode unavailable", undefined, {
      popoverSupported: isPopoverSupported(),
      fullscreen: Boolean(document.fullscreenElement),
      tagName: element.tagName,
    });
    return false;
  }

  ensureTheaterStyles(element);

  const session: TheaterSession = {
    element,
    childWindow,
    previousPopover: element.getAttribute("popover"),
    // Site-drawn controls stay behind in the page, so expose native controls
    // for mouse users while the video is promoted.
    addedControls: element instanceof HTMLVideoElement && !element.controls,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    observer: new MutationObserver(() => {
      void getTheaterElement();
    }),
  };

  element.setAttribute(THEATER_ATTR, "true");
  element.setAttribute("popover", "manual");
  if (session.addedControls && element instanceof HTMLVideoElement) {
    element.controls = true;
  }

  try {
    element.showPopover();
  } catch (error) {
    restoreElement(session);
    debugLog("Theater mode failed to open", undefined, {
      error: String(error),
      tagName: element.tagName,
    });
    return false;
  }

  activeSession = session;
  element.addEventListener("toggle", handleTheaterToggle);
  if (element instanceof HTMLIFrameElement) {
    element.addEventListener("load", handleTheaterFrameLoad);
  }
  session.observer.observe(document, { childList: true, subtree: true });
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) {
    session.observer.observe(root, { childList: true, subtree: true });
  }

  return true;
}

export function enterTheater(media: HTMLVideoElement): boolean {
  return promote(media, null);
}

/**
 * Enlarges the iframe hosting a child frame that entered theater mode. Callers
 * must have verified that this frame routed toggleTheater to that child.
 */
export function enterFrameTheater(iframe: HTMLIFrameElement): boolean {
  return iframe.contentWindow ? promote(iframe, iframe.contentWindow) : false;
}

export function isTheaterActive(): boolean {
  return getTheaterElement() !== null;
}

export function isTheaterChildFrame(frameWindow: Window): boolean {
  return activeSession !== null && activeSession.childWindow === frameWindow;
}

/**
 * Asks the parent frame to enlarge this frame. With a requestId the parent
 * checks its routing grant; without one it only agrees if this frame's iframe
 * holds focus there.
 */
export function requestParentTheater(requestId?: string): void {
  if (window.parent !== window) {
    postTheaterMessage(window.parent, true, requestId);
  }
}

/**
 * Leaves theater mode in this frame and tells both neighbors: the parent
 * shrinks the iframe hosting this frame, and a promoted child frame exits its
 * own theater mode. Frames ignore exit notices that do not match their state,
 * so the echo back from the other side ends there.
 */
export function exitTheater({ restoreScroll = true }: { restoreScroll?: boolean } = {}): boolean {
  const session = activeSession;
  if (!session) {
    return false;
  }

  activeSession = null;
  session.observer.disconnect();
  session.element.removeEventListener("toggle", handleTheaterToggle);
  session.element.removeEventListener("load", handleTheaterFrameLoad);
  restoreElement(session);

  // While promoted, the element leaves normal flow; if the page got shorter
  // the browser may have clamped the scroll position, so put the reader back.
  if (restoreScroll) {
    window.scrollTo(session.scrollX, session.scrollY);
  }

  if (session.childWindow) {
    postTheaterMessage(session.childWindow, false);
  }
  if (window.parent !== window) {
    postTheaterMessage(window.parent, false);
  }

  return true;
}

export function toggleTheater(media: HTMLVideoElement): boolean {
  if (getTheaterMedia() === media) {
    return !exitTheater();
  }

  return enterTheater(media);
}
