export const MESSAGE_SOURCE = "media-hotkeys-extension";
export const ACTION_REQUEST_TYPE = "MEDIA_HOTKEYS_HANDLE_ACTION";
export const ACTION_RESPONSE_TYPE = "MEDIA_HOTKEYS_ACTION_RESULT";
export const SCORE_REQUEST_TYPE = "MEDIA_HOTKEYS_SCORE_REQUEST";
export const SCORE_RESPONSE_TYPE = "MEDIA_HOTKEYS_SCORE_RESPONSE";
export const SITE_POLICY_TYPE = "MEDIA_HOTKEYS_SITE_POLICY";
export const THEATER_TYPE = "MEDIA_HOTKEYS_THEATER";
export const MEDIA_PRESENCE_TYPE = "MEDIA_HOTKEYS_MEDIA_PRESENCE";
export const MEDIA_PRESENCE_REQUEST_TYPE = "MEDIA_HOTKEYS_MEDIA_PRESENCE_REQUEST";

// Total time budget for the cross-frame scoring phase; nested frames receive a
// smaller budget so their responses can still arrive within the parent's window.
export const SCORE_BUDGET_MS = 150;
export const SCORE_CHILD_BUDGET_MARGIN_MS = 50;
export const SCORE_MIN_CHILD_BUDGET_MS = 40;
export const EXECUTE_TIMEOUT_MS = 250;
export const EXECUTE_PLACEHOLDER_TIMEOUT_MS = 1400;
export const EXECUTE_ROUTE_TTL_MS = 2000;
// Coalesces bursts of DOM and media changes into one presence report upward.
export const MEDIA_PRESENCE_REPORT_DELAY_MS = 100;

export const FULLSCREEN_WRAPPER_ATTR = "data-media-hotkeys-fullscreen-wrapper";
export const FULLSCREEN_STYLE_ATTR = "data-media-hotkeys-fullscreen";
export const THEATER_ATTR = "data-media-hotkeys-theater";
export const THEATER_STYLE_ATTR = "data-media-hotkeys-theater-style";
export const OVERLAY_ATTR = "data-media-hotkeys-overlay";
export const OVERLAY_ID = "media-hotkeys-overlay";

// Outside HTML documents (SVG, XML), `createElement` makes a namespaceless element, which has no
// `style` and can't host a shadow root or act as a style sheet. Extension-created elements name
// this namespace instead.
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

// Dispatched by src/player-bridge.ts (main world) on a host that just attached
// a shadow root. Keep the value in sync with the bridge, which can't import it.
export const SHADOW_ROOT_ATTACHED_EVENT = "media-hotkeys-shadow-root-attached";
