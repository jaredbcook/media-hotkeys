# Architecture

How Media Hotkeys is put together and why. Read this before changing behavior in `src/`. For setup and commands see [CONTRIBUTING.md](CONTRIBUTING.md); for user-facing behavior see [README.md](README.md).

This document describes structure and design decisions that change rarely. Exact numbers (score weights, timeouts, default settings) live in code and are referenced by name, not copied here.

## Bird's-eye view

The extension is a Manifest V3 web extension with four runtime pieces:

| Piece                  | Entry                           | Runs in                                          | Job                                                                        |
| ---------------------- | ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Content script         | `src/content.ts`                | Every frame, isolated world, `document_idle`     | Maps keys to actions, picks the target media, acts, shows the overlay      |
| Player bridge          | `src/player-bridge.ts`          | Every frame, page's main world, `document_start` | Calls page-defined custom-element player APIs the isolated world can't see |
| Quick settings popup   | `src/quick-settings-popup.ts`   | Toolbar action popup                             | Global toggle, version, key bindings, current-site policy                  |
| Advanced settings page | `src/advanced-settings-page.ts` | Options page (opens in a tab)                    | Playback, skip, volume, overlay, site policies, debug logging              |

There is no background service worker. All state that crosses contexts goes through `browser.storage.sync` (settings) or `window.postMessage` (frame-to-frame coordination).

A keypress flows through the content script like this:

```
keydown (capture) ─► keyboard.ts ─► media-presence.ts: any reachable media?  no ─► key stays with the page
                                    │ yes: preventDefault
                                    ▼
                                dispatch.ts ─────┬─► media-scoring.ts      (local candidates)
                                                 ├─► frame-messaging.ts    (child-frame scores)
                                                 └─► winner frame ─► actions.ts ─► player-control.ts
                                                                                 └► overlay.ts
                     no media anywhere? ─► placeholder.ts (click a thumbnail facade, then retry)
```

## Code map

Every file under `src/` is listed here; `tests/unit/docs/docs-consistency.test.ts` fails if one is missing.

### Content script (`src/content/`)

| File                             | Responsibility                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/content.ts`                 | Entry point. Registers document listeners and re-exports a small API used by tests.                           |
| `src/content/state.ts`           | The only shared mutable state: settings, key map, last-interacted and last-actioned media.                    |
| `src/content/constants.ts`       | `postMessage` types, cross-frame timeouts and budgets, extension-owned DOM attribute names.                   |
| `src/content/keyboard.ts`        | `keydown` handling: theater `Esc`, enabled/site/editable/modifier guards, key lookup, non-Latin fallback.     |
| `src/content/dispatch.ts`        | Chooses which frame executes an action; handles all incoming frame messages.                                  |
| `src/content/frame-messaging.ts` | The cross-frame protocol: score requests, execute routing, site-policy propagation, theater grants.           |
| `src/content/media-discovery.ts` | Finds media and iframes, including inside open shadow roots; ambient-media heuristic.                         |
| `src/content/media-scoring.ts`   | Weighted scoring of local candidates (weights are the `SCORE_*` constants).                                   |
| `src/content/media-presence.ts`  | Tracks which child frames report media; decides synchronously whether a key may be taken from the page.       |
| `src/content/media-tracking.ts`  | `MutationObserver` on the document and every shadow root, late ones too; interaction and pointer tracking.    |
| `src/content/actions.ts`         | Executes an action on the chosen media and builds overlay display options (including skip streaks).           |
| `src/content/player-control.ts`  | Reads and writes media state, preferring custom-player host APIs, falling back to `HTMLMediaElement`.         |
| `src/content/captions.ts`        | Toggles a media element's native caption and subtitle text tracks and remembers the one to restore.           |
| `src/content/placeholder.ts`     | Detects and clicks thumbnail "facades" when there is no real media yet.                                       |
| `src/content/fullscreen.ts`      | Wraps media in a managed container for fullscreen so the overlay can render on top.                           |
| `src/content/theater.ts`         | Theater mode: top-layer popover promotion of the video and of hosting iframes.                                |
| `src/content/settings-sync.ts`   | Loads settings, reloads on `storage.onChanged`, and saves the overlay toggle.                                 |
| `src/content/dom-utils.ts`       | Visibility, ancestor-clipped visible box, viewport area, deep active element, editable detection, `debugLog`. |

### Shared and UI (`src/`)

| File                              | Responsibility                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/storage.ts`                  | Settings types, `MediaAction`, the stored key layout, patch saves, site-policy matching (no tldts).                   |
| `src/site-patterns.ts`            | Turns entered rules and page URLs into saved site patterns, validating hosts with tldts. Popup and options page only. |
| `src/settings/defaults.json`      | Single source of truth for default settings and key bindings.                                                         |
| `src/overlay.ts`                  | The on-screen action indicator: closed shadow root, anchoring, sizing, top-layer promotion, fade.                     |
| `src/icons.ts`                    | Inline SVG strings for overlay and settings UI icons (sourced from `assets/material-icons/`).                         |
| `src/player-bridge.ts`            | Main-world bridge for whitelisted custom-player host operations. Must stay import-free.                               |
| `src/quick-settings-popup.html`   | Popup markup.                                                                                                         |
| `src/quick-settings-popup.ts`     | Popup logic: global toggle, key capture, binding table, site-policy checkboxes. `ACTION_LABELS` names actions.        |
| `src/advanced-settings-page.html` | Options page markup.                                                                                                  |
| `src/advanced-settings-page.ts`   | Options page logic: debounced autosave, validation, site-policy list, version and report-issue link.                  |
| `src/advanced-settings.ts`        | Populate/collect helpers for the advanced settings form.                                                              |
| `src/status-toast.ts`             | Transient "Settings saved." / error toasts used by both settings UIs.                                                 |
| `src/confirm-dialog.ts`           | Modal confirmation dialog (native `<dialog>`) both settings UIs show before Restore Defaults.                         |
| `src/ui.css`                      | Shared styles for popup and options page (light and dark).                                                            |

### Build and tests

- `scripts/build.ts` runs the Vite configs from `vite.config.ts` once per browser and writes `dist/<browser>/manifest.json` from `manifest.template.json`, stamping `version` from `package.json` and adding Gecko settings for Firefox: the add-on id, `strict_min_version` 128 (main-world content scripts), and the `data_collection_permissions` declaration that addons.mozilla.org requires.
- `scripts/package.ts` builds, then zips each browser into `dist/packages/`. The Firefox package is named `-unsigned.xpi` because Mozilla signs it only when it is uploaded to addons.mozilla.org.
- `scripts/safari-convert.ts` prints the `xcrun safari-web-extension-converter` command for the Chrome build (macOS only).
- Tests: `tests/unit/` and `tests/ui/` (Vitest + jsdom), `tests/e2e/` (Playwright against the built Chrome extension). See [CONTRIBUTING.md](CONTRIBUTING.md#testing).

## Target selection

Each frame scores its own targetable media (`media-scoring.ts`). The highest score above zero wins; ties go to the earliest in DOM order. Signals, strongest first:

1. Fullscreen, picture-in-picture, or theater-mode element
2. Focused element
3. Playing and audible
4. Last media the user interacted with (click, play, focus)
5. Last media the extension acted on
6. Playing but muted
7. Visible viewport area (videos only, proportional), pointer hover, native controls, audio base, non-ambient base
8. Ambient penalty: a muted video without controls is penalized. A decorative loop (ambient and `loop`) also gets no credit for muted playback or area
9. Hidden penalty: a video the page hides, or any media inside a hidden iframe, is penalized

Design rules behind the signals:

- **Intent beats prominence.** The weights are ordered so explicit user intent always outranks visual size. Change the `SCORE_*` constants only with tests that pin the new ordering.
- **"Playing" tolerates buffering.** Media counts as playing when it is not paused or ended and has at least metadata, so a keypress during a stall still targets it.
- **Clicks on custom controls count.** Players such as YouTube, Vimeo, Video.js, and Plyr layer controls over the `<video>`. A capture-phase `pointerdown` on the document credits the innermost visible media under the pointer.
- **Ambient is a penalty, not an exclusion.** A muted video without controls can still win if the user focuses or clicks it, or the extension already acted on it (`actionedMedia`). An idle one scores below zero and is never chosen. A playing, non-looping one, such as a feed video that autoplays muted, can also win by dominating the viewport.
- **Decorative loops need explicit intent.** Hero backgrounds, hover previews, and menu teasers are muted loops without controls (`isDecorativeLoop`), and their size or playback says nothing about wanting to control them. They become targets only through focus, a press in their box, fullscreen, PiP, theater, or an earlier extension action. `play` events from ambient media don't count as interaction either: autoplay must start muted, sites often set `loop` only after playback starts, and crediting it would take the credit from the player the user chose. The cost: muted looping feed players (short-video sites) need a click before keys reach them. Click-to-play posters are a separate path (see [Playable placeholders](#playable-placeholders)).
- **Hidden means hidden by the page, not scrolled away.** `getVisibleBox` in `dom-utils.ts` clips a video's box by its ancestors. A video is hidden when it or an ancestor has `display: none`, `visibility: hidden`, or zero opacity, or when an `overflow: hidden` or `clip` ancestor in its containing-block chain cuts it off entirely, as in a collapsed mega menu. Hidden videos get no area or hover credit, presses inside their box aren't attributed to them, and their `play` events don't count as interaction. Like ambient, hidden is a penalty, not an exclusion: audible playback, focus, or an earlier extension action still wins, so canvas-based players that hide their `<video>` keep working once controlled. A video clipped by a scroll container or outside the viewport is not hidden, because the user can scroll it into view. An iframe that is hidden the same way, or is 0x0 (such as a lightbox player preloaded before it opens), hides its whole subtree; see [Cross-frame arbitration](#cross-frame-arbitration).
- **Interaction memory survives DOM churn.** `lastInteractedMedia` is cleared only when that element leaves the document, not on unrelated mutations.

## Taking keys from the page

A matched key is only taken from the page (`preventDefault` and `stopPropagation`) when it can reach media. Otherwise pages without media would lose arrow-key scrolling and their own shortcuts (`j`, `k`, `o`, and others) to the extension. The decision must be synchronous, before any cross-frame round trip, so `media-presence.ts` keeps it answerable from local state:

- **This frame:** a local candidate scores above zero, or theater mode is active.
- **Child frames:** each frame posts `MEDIA_HOTKEYS_MEDIA_PRESENCE` to its parent with whether its subtree has controllable media. It reports when it loads, and after DOM mutations, `loadstart`, `emptied`, and `volumechange`, debounced and only on change. A frame that starts listening asks its children to report again, because reports sent before its content script loaded are lost. Ambient loops don't count, so a muted video ad in an iframe doesn't capture keys. Neither do reports from a hidden iframe (`isIframeHidden`).
- **Vertical scroll keys:** `ArrowUp`, `ArrowDown`, `Space`, `PageUp`, `PageDown`, `Home`, and `End` stay with the page when it, or a scroll container around the key's target, can scroll, unless media in this frame is in use (`hasMediaInUse` in `media-scoring.ts`): fullscreen, PiP, theater, or focused, or on screen and interacted with, acted on, or playing with sound. Otherwise reading past an idle video in an article would change its volume instead of scrolling. Media in child frames doesn't count; clicking into the embed moves the keys into that frame anyway.
- **Captions key only:** the media this frame would act on (`getTargetMedia`) has a caption or subtitle text track the extension may switch (`hasCaptionTracks` in `captions.ts`), theater mode included. Players that draw their own captions have no such track, so the key stays with the page and its own shortcut keeps working. If any caption or subtitle track is in `hidden` mode, none count: that is how players such as Plyr and Video.js read cues to draw captions themselves, and showing one of their other tracks would draw it over theirs. A player that leaves every track `disabled` while its captions are off can't be told apart from a native one, so it loses the key. Presence reports say whether a frame has media, not whether it has tracks, so media in another frame never claims the key; the user normally clicked into that frame, which then receives the key itself. If arbitration picks media in a child frame without a track, that frame reports the action as not handled, and each frame up the route falls back to its own media in turn, ending at the frame that got the key, whose media had a track; in any case an action on media without a track does nothing and credits no media.
- **Play key only:** a click-to-play placeholder in this frame, or a visible iframe big enough to hold one that looks like a video embed: it has `allowfullscreen` (or a vendor-prefixed form), or an `allow` attribute granting `autoplay` or `fullscreen`, as embed snippets from YouTube, Vimeo, and other players do. Ad iframes are often player-sized but don't ask for these, so pages that use `k` themselves keep it next to an ad. Placeholder scans are too expensive to run on every mutation, so placeholders aren't reported across frames.

When nothing qualifies, the key passes through untouched and no arbitration runs. The overlay toggle follows the same rule. Accepted gaps: a key pressed in the first moments after an iframe loads, or ambient media inside an iframe, stays with the page until the user clicks into the frame. Media playing in a hidden iframe also leaves keys with the page, because presence reports don't say whether the media is audible.

## Cross-frame arbitration

The content script runs independently in every frame and frames cannot see each other's DOM, so exactly one frame must be chosen to act. `dispatch.ts` and `frame-messaging.ts` use a two-phase protocol:

1. **Score.** The initiating frame scores local candidates and sends `SCORE_REQUEST` to child frames. Each child answers with the best score in its subtree within a shrinking time budget and records which descendant owns it, keyed by request id. Responses carry the visible-area part of the score separately. The parent rescales it by how much of its own viewport the iframe covers, so a video filling a tiny ad iframe can't claim a full area score, and applies the hidden penalty when the iframe is hidden. A child whose adjusted score is no longer above zero is dropped.
2. **Execute.** The initiator compares local and child scores (local wins ties) and sends the action to the one winning frame, which routes it hop by hop to the recorded descendant. On failure or timeout the initiator falls back to its best local candidate.

Shortcuts and exceptions:

- When local intent is unambiguous (score at or above `STRONG_LOCAL_TARGET_SCORE`: focus, fullscreen, PiP, theater), the round trip is skipped.
- When no frame has scorable media, placeholder activation is tried locally first, then broadcast to child frames.
- The overlay toggle changes a setting, not media, so only its confirmation is arbitrated. The frame that received the keypress flips `showOverlays` and saves it (`toggleOverlayVisibility` in `settings-sync.ts`): one write per keypress however many frames the page has. Every other frame picks the change up from `storage.onChanged`. The confirmation overlay then goes to the one winning frame like a media action, and the execute request carries the new value (`overlaysEnabled`), because that frame may not have reloaded settings yet. A frame that receives the request only displays that value. It never flips or saves the setting, and its own copy changes only when storage reports it, so a late or repeated request can't turn the value back. If the key is pressed again in the same frame while an earlier confirmation is still being arbitrated, the earlier one is not sent. Accepted gaps, since frames share no clock or lock: a confirmation already sent is not recalled, and a frame only knows about its own presses, so when quick presses land in different frames or the winning frame changes between them, an older value can be shown last or two frames can briefly show different values. And a second press in a different frame, before that frame has reloaded the first change (a few milliseconds), picks the same value again: the setting stays as the first press left it, with at most a repeated write of that same value, and the confirmation shows it.
- Any page or frame can post these messages, so each is accepted only from the direction the protocol sends it (`isFromParentFrame` and `isFromChildFrame` in `frame-messaging.ts`): score and execute requests and site policies only from `window.parent`, and results only from this frame's own iframes. Execute requests must name an action in `MEDIA_ACTIONS`, and an overlay toggle request must carry the boolean to display. Otherwise an ad iframe could make the page act on its media. No frame message changes saved settings.
- Message type strings and timeouts are in `src/content/constants.ts`. Every frame runs the same build, so the protocol has no versioning.

## Playable placeholders

Many pages show a thumbnail facade and only create the real player on click (YouTube cued embeds, `lite-youtube`, lazy-loaded embeds). When no frame has scorable media, `placeholder.ts` finds the best facade, clicks it, and waits for media to appear.

- A candidate needs a visible, thumbnail-sized box with duration text plus a play control or thumbnail. Without duration text it needs both a thumbnail and an unambiguous play control: an accessible name that says "play" (several languages), or a centered overlay matching play-button class conventions (`vjs-big-play-button`, `lty-playbtn`, `.play`).
- "Watch" is not treated as a play label; on real pages it usually means navigation.
- The innermost qualifying candidate wins over wrappers that inherit its signals.
- **Pressing play never navigates away.** Facades inside same-site links (search results, "more videos" rails) are skipped because SPA routers intercept those clicks. For cross-origin links (no-JS fallbacks to the provider), the click goes through but navigation the page didn't `preventDefault` is cancelled.

## Custom players

The extension is native-media first: it controls real `HTMLMediaElement`s, and only uses a player's host API when the media lives inside an open shadow root of a custom element (`player-control.ts`). Page-defined element methods are invisible to the isolated world, so `player-bridge.ts` runs in the main world and executes a fixed whitelist of synchronous operations, exchanged through a DOM event plus temporary `data-media-hotkeys-*` attributes. A call that fails synchronously falls back to direct media control.

Host methods can return a promise that rejects when the browser or the player refuses (`requestFullscreen` without user activation, a player whose backend fails). Both ways of calling one settle that promise, so a refusal never reaches the page as an unhandled rejection: `player-control.ts` logs it with `debugLog`, and the bridge, which is import-free and must not write into the page's console, drops it silently. A synchronous call (`pause`, `requestFullscreen`) still counts as handled when its promise rejects, because it returns before the promise settles. Only a direct `play()` is awaited, and its refusal falls back to the bridge, the play button, and the media element.

The bridge also patches `Element.prototype.attachShadow`, because the content script's isolated world has its own prototypes and never sees the page's calls. When a connected host attaches a shadow root, the patch dispatches a composed, non-bubbling `media-hotkeys-shadow-root-attached` event on it. The content script listens in the capture phase on `document`, which receives the event across shadow boundaries, and observes `host.shadowRoot` so media added inside is tracked and reported. Hosts that attach a root while detached are found when they are inserted, and the initial scan walks roots that already exist. Closed roots can't be read from the isolated world, so media inside them isn't tracked.

Actions and the overlay read playback state (paused, time, duration, volume, muted, rate) with the `readPlayer*` helpers in `player-control.ts`, and change it with `playMedia`, `pauseMedia`, and the `setPlayer*` helpers, never on the element directly. What an action decides (pause or play, where a skip streak ends) and what the overlay shows then come from the same state, even when a host's differs from its inner media element's. Target scoring and placeholder activation still read the element directly; that gap is tracked in [#71](https://github.com/jaredbcook/media-hotkeys/issues/71).

Captions are native-only: the `toggleCaptions` action switches `HTMLMediaElement.textTracks` and never reaches into a player's host API. Whether custom players' own captions can be toggled is researched in [#69](https://github.com/jaredbcook/media-hotkeys/issues/69).

Provider iframes (YouTube, Vimeo, and similar) are handled by the content script running inside them when the browser allows it. The extension injects no provider SDKs and has no per-provider adapters. The only button it ever clicks is a play button (placeholders and shadow-DOM play fallback); clicking arbitrary mute, seek, or fullscreen buttons risks hitting the wrong control or double-toggling.

The per-player research behind these choices is in [docs/player-compatibility.md](docs/player-compatibility.md).

## Theater mode

Theater mode promotes the target `<video>` into the browser's top layer as a manual popover instead of moving it into a dialog. The element never changes DOM position, so player scripts, framework reconcilers, and wrapper CSS keep working, and the top layer escapes ancestor transforms, `overflow` clipping, and stacking contexts. Sizing rules are `!important` inside a cascade layer so they beat both unlayered `!important` site styles and inline sizes that players rewrite on resize. Site-drawn controls and captions stay behind in the page, so native `controls` are enabled while active and the overlay is promoted into the top layer too. `Esc` or the hotkey exits and restores scroll position. `Esc` works even if hotkeys are disabled or focus moved into an input.

A video is never in theater mode and picture-in-picture at once, so a backdrop can't be left covering the page in front of an empty popover. Theater mode listens for `enterpictureinpicture` on its video and exits when it fires, which covers every way PiP can start in browsers that expose the API to pages: the hotkey, the browser's own button, and the page's controls. Firefox doesn't, so its native PiP button isn't detected ([#88](https://github.com/jaredbcook/media-hotkeys/issues/88)). The hotkey doesn't leave theater mode before it asks for PiP, so a request the browser rejects (no video track yet, or `disablePictureInPicture`) keeps theater mode open. In the other direction, `enterTheater` in `theater.ts` exits a video that is in PiP in this document instead of refusing theater mode, because a refused `t` would do nothing for a video the user is watching in the PiP window. `exitPictureInPicture()` only rejects when no PiP is active, so its result is ignored. Leaving theater mode from inside an iframe already tells the parent to shrink the hosting iframe, so a framed video entering PiP unwinds both levels. This mirrors how `toggleFullscreen` leaves theater mode, except that fullscreen has to do it before the request because it reparents the video. Only the theater video is watched: another video entering PiP, in this document or another frame, leaves theater mode open, since the theater video is still on screen ([#87](https://github.com/jaredbcook/media-hotkeys/issues/87)).

The trade is that a custom player's own controls and captions are lost, and for a player embed the iframe's own UI is left behind even though its iframe fills the window. What was measured, and the planned changes (enlarge only a player iframe, promote a verified container for same-document players), are in [docs/theater-controls.md](docs/theater-controls.md).

For a video inside an iframe, each ancestor frame promotes the hosting `<iframe>` the same way. A child asks its parent with a `MEDIA_HOTKEYS_THEATER` message, and **the parent only honors it when it has a reason to trust the request**: it routed `toggleTheater` to that exact frame under the message's `requestId` within the route TTL, or that iframe is the focused element in the parent (following focus into open shadow roots). The parent then repeats the request upward under the same rules. Without these checks any embedded frame, such as an ad, could cover the page. Exit notices need no trust; each side ignores notices that don't match its state.

## Overlay

The action overlay is split in two so page CSS can't restyle it:

- **Host.** A `div#media-hotkeys-overlay` in the page's DOM (the `body`, or the fullscreen element so it shows above fullscreen video). It carries only position, visibility, and the fade, and in theater mode the `popover` attribute that promotes it to the top layer. Because the page can select the host, its styles start from `all: initial` and are all set inline with `!important` (`setHostStyle` in `src/overlay.ts`), which outranks page rules of either importance. That also neutralizes the UA popover box.
- **Shadow root.** The host's closed shadow root holds a single box with the icon, text, and everything that makes it look like an overlay, plus the skip-slide `@keyframes`. Page selectors for `div`, `span`, or `svg` can't reach it, and page scripts get `null` from `host.shadowRoot`. The box, not the host, animates the skip slide, so the host's `transform` can keep positioning.

The overlay is built on the first `showActionOverlay`, so pages that never show one are untouched. A host that the page removes is rebuilt, and a leftover one from an earlier content script (after an extension update) is removed, because the new script can't reach into its closed root. Only an element carrying the `data-media-hotkeys-overlay` attribute counts as ours, both for that cleanup and for the mutation observer, which ignores the host and never sees inside the root; a page element that merely shares the id is left alone. (A hidden host from a build before the attribute existed stays in the page, since it can't be told from a page's own element.)

Tests can't see into a closed root either. Unit tests record the root as it is attached; E2E tests read it from the content script's isolated world (see [CONTRIBUTING.md](CONTRIBUTING.md#testing)).

## Settings and site policies

- **Schema.** `ExtensionSettings` in `src/storage.ts` is what the code reads: three groups, `quickSettings` (enabled toggle, key bindings), `advancedSettings` (playback, skip, volume, overlay, debug), and `siteSettings` (`sitePolicies`). Defaults come only from `src/settings/defaults.json`.
- **Stored layout.** `storage.sync` does not hold that object. It holds one flat key per setting, and only for settings the user changed: `quick.hotkeysEnabled`, `advanced.<setting>`, `keys.<action>` (that action's list of keys), `sitePolicies` (the rules, one array until [#70](https://github.com/jaredbcook/media-hotkeys/issues/70) gives each rule its own key), and `schemaVersion`, written with the first key that is set (only while it is missing, so an older version doesn't normally lower a newer one's marker; the check isn't atomic, so a migration that relies on it must tolerate a stale `1`), so a later layout can migrate. `getSettings` fills everything without a key from the defaults, so a default changed in a release reaches everyone who never touched that setting, and a stored value of the wrong type falls back to its default. A newly added action's default key is dropped if the user already bound that key to another action; since only changed bindings are stored, those are exactly the keys the user chose. Keys this version doesn't know (an older layout, or a newer version's) are ignored and never removed. Settings saved by the earlier grouped layout (`quickSettings`, `advancedSettings`, `siteSettings` objects) are not migrated, because that layout was never released; they are ignored and the settings start from the defaults.
- **Saving.** `saveSettings` takes a patch in the shape of `ExtensionSettings` (`SettingsUpdate`) and never reads the settings (only the `schemaVersion` marker, to leave a newer one alone). It `set`s the keys whose value differs from the default and `remove`s the keys whose value is back at the default, so "reset" is removing a key. Two saves of different settings can't overwrite each other, and for one setting the last write wins. `set` and `remove` are separate writes, so a save that does both counts as two against Chrome's write limits (120 a minute, 1,800 an hour); the limits that decided the layout are in the comment above `SETTINGS_SCHEMA_VERSION`. Everything read or written goes through `src/storage.ts`; never write storage directly, and use `saveSettings`.
- **Surfaces send what changed.** The popup and the options page keep a snapshot of the settings (`currentSettings`) and compute each save as `diffSettings(snapshot, next)`, so a stale snapshot can only affect what the user edited. Both listen to `storage.onChanged`, wait for their own saves to land, read the settings again, and update the snapshot and the controls. Only the newest read is applied, a read that one of their own edits overtook is skipped (that edit's save fires its own change event), a change announced while the first read was in flight triggers another read, and the options page keeps text typed since its last save. The popup rebuilds its key table (cancelling a pending key capture) only when the bindings changed. If a save fails, the surface shows an error and re-reads storage so it doesn't keep showing an edit that was not saved. Site rules are still one stored array that the options page saves whole, so a refresh doesn't replace rows being edited (it is retried when focus leaves the list), and saving them can overwrite a rule list changed elsewhere meanwhile; [#70](https://github.com/jaredbcook/media-hotkeys/issues/70) removes that gap.
- **Site policies.** Rules are hosts (`youtube.com`, `music.youtube.com`) or path prefixes (`youtube.com/shorts`). A rule stores the host the user chose, not its registrable domain, so a rule can target one subdomain. The popup and options page normalize rules before saving (`normalizeDisabledUrlPattern` in `src/site-patterns.ts`): the host is kept as given, lowercased, with a leading `www.` removed. Only validation uses tldts: a bare ICANN public suffix (`com`, `co.uk`) or a single label is refused, while a private suffix such as `github.io` is accepted and covers every site under it. `findMatchingSitePolicy` in `src/storage.ts` matches a saved host against the page's hostname when they are equal or the hostname ends with `.` plus the saved host, so whole labels only and `notyoutube.com` never matches `youtube.com` (localhost and IP addresses only exactly). Matching needs no suffix list, which keeps tldts out of the content script that loads in every frame (`tests/unit/content/content-imports.test.ts` guards this). Saved hosts nest (`youtube.com` and `music.youtube.com`), and the longer matching host wins. A rule saved for a wider host keeps covering its subdomains, so no migration was needed when rules stopped being reduced to the registrable domain. Rules have a mode (`disabled` or `enabled`) and an embeds policy (`inherit` or `ignore`). The most specific matching rule (longest host, then longest path) wins. Policies are evaluated against the top-level URL, and again when it changes in place (single-page apps): `isSiteDisabledByPolicy` checks the URL on each use, and `popstate`, the Navigation API, and DOM mutations trigger a re-check that reaches child frames. The top frame broadcasts its effective policy to child frames with `MEDIA_HOTKEYS_SITE_POLICY` when it changes, and every frame also answers each child's presence report with it, so a frame whose content script starts late still learns it. An iframe therefore can't bypass a disabled page unless that rule's embeds policy is `ignore`.
- **Propagation.** Settings UIs save on change (the patches above). Every content script listens to `storage.onChanged` and reloads, so changes apply without reloading pages. The overlay hotkey is the only place a content script saves. The frame that got the key queues its saves so quick presses are written in order, and until they settle its chosen value wins over what a reload reads back, so a change event from an earlier press can't undo a later one. When the last save settles, the frame reads storage once more, which puts back the stored value after a failed write or a change made elsewhere in the meantime.

## Build and manifest

- One `manifest.template.json`, specialized per browser by `scripts/build.ts`. Manifest V3 everywhere. Permissions are `storage` and `activeTab`; page access comes only from `content_scripts` matching `<all_urls>` with `all_frames`.
- `minimum_chrome_version` is 114 for Chrome and Edge: the overlay uses popovers to reach the top layer (Chrome 114), and `player-bridge.js` is a main-world content script (Chrome 111). Firefox ignores the key; its minimum is `strict_min_version`, set by `scripts/build.ts`.
- Vite builds four bundles: `content.js` and `player-bridge.js` as IIFEs (content scripts can't be ES modules), the popup and the options page as ES modules. Output is minified (whitespace, syntax, and local names shortened, with no obfuscation) and has no source maps; `--no-minify` builds a readable copy for debugging (see [CONTRIBUTING.md](CONTRIBUTING.md#debugging)).
- Safari isn't a build target. It is produced by converting the Chrome build with Xcode.

## Invariants

Breaking one of these is a bug even if tests pass:

- Use `webextension-polyfill`, never `chrome.*` (`tsconfig.app.json` omits Chrome globals so `tsc` rejects it).
- No `host_permissions`, no background script, Manifest V3 only.
- Hotkeys never fire while focus is in an editable element (text-entry `input` types, `textarea`, `select`, `contenteditable`, including inside shadow roots) or with Ctrl, Alt, or Meta held (a character typed with AltGr counts as a plain key). `hasReservedModifier` in `src/storage.ts` decides this for both the content script and key capture in the popup, so the popup refuses to bind a combination that would never fire.
- A key is only taken from the page when `hasPotentialTarget` says media may be reachable.
- Exactly one frame executes a media action.
- Only the frame that received the keypress saves the overlay toggle, once per keypress. Frame messages never change saved settings.
- Cross-frame requests are accepted only from the parent frame, and results only from child frames.
- Theater promotion of an iframe requires a route grant or iframe focus.
- Pressing play on a placeholder never navigates the page.
- `player-bridge.ts` imports nothing and only runs whitelisted operations.
- Extension-created DOM is tagged with `data-media-hotkeys-*` attributes or the `media-hotkeys-overlay` id (see `constants.ts`) so the mutation observer ignores it.
- What the overlay shows lives in a closed shadow root, and its host's styles are inline and `!important`.
