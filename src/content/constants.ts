export const MESSAGE_SOURCE = "media-shortcuts-extension";
export const ACTION_REQUEST_TYPE = "MEDIA_SHORTCUTS_HANDLE_ACTION";
export const ACTION_RESPONSE_TYPE = "MEDIA_SHORTCUTS_ACTION_RESULT";
export const SCORE_REQUEST_TYPE = "MEDIA_SHORTCUTS_SCORE_REQUEST";
export const SCORE_RESPONSE_TYPE = "MEDIA_SHORTCUTS_SCORE_RESPONSE";
export const SITE_POLICY_TYPE = "MEDIA_HOTKEYS_SITE_POLICY";
export const THEATER_TYPE = "MEDIA_HOTKEYS_THEATER";

export const FRAME_ACTION_TIMEOUT_MS = 150;
// Total time budget for the cross-frame scoring phase; nested frames receive a
// smaller budget so their responses can still arrive within the parent's window.
export const SCORE_BUDGET_MS = 150;
export const SCORE_CHILD_BUDGET_MARGIN_MS = 50;
export const SCORE_MIN_CHILD_BUDGET_MS = 40;
export const EXECUTE_TIMEOUT_MS = 250;
export const EXECUTE_PLACEHOLDER_TIMEOUT_MS = 1400;
export const EXECUTE_ROUTE_TTL_MS = 2000;

export const FULLSCREEN_WRAPPER_ATTR = "data-media-hotkeys-fullscreen-wrapper";
export const FULLSCREEN_STYLE_ATTR = "data-media-hotkeys-fullscreen";
export const THEATER_ATTR = "data-media-hotkeys-theater";
export const THEATER_STYLE_ATTR = "data-media-hotkeys-theater-style";
export const OVERLAY_STYLE_ATTR = "data-media-shortcuts-overlay";
export const OVERLAY_ID = "media-shortcuts-overlay";
