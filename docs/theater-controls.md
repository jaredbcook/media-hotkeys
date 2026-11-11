# Theater mode: native versus site controls and captions

Evaluation of how theater mode should treat a player's own controls and captions, written for [#32](https://github.com/jaredbcook/media-hotkeys/issues/32). The design it evaluates is in [ARCHITECTURE.md](../ARCHITECTURE.md#theater-mode). Like [player-compatibility.md](player-compatibility.md), these are observations of third-party players on the test date (2026-11-11), not guarantees; re-check a player before relying on a row.

## Recommendation

Keep the invariants of the current design (no DOM moves, top-layer promotion, iframe trust checks) and change **what** gets promoted, in two independent steps:

1. **Iframe players: promote only the iframe** ([#74](https://github.com/jaredbcook/media-hotkeys/issues/74)). When the video fills its frame, the frame is the player. Enlarging the iframe alone keeps the provider's controls, menus, timeline previews, and captions. This needs no container detection and no site-specific code, and it fixes YouTube embeds, and by the same mechanism should fix Vimeo's (not verified with the extension, see [How it was tested](#how-it-was-tested)). The parent's reply to the child is one-way today, so the child must be told whether the iframe was actually enlarged and fall back to promoting its video if not.
2. **Same-document custom players: promote the matching container, verify, and fall back** ([#75](https://github.com/jaredbcook/media-hotkeys/issues/75)). Promote the outermost ancestor that still has the same box as the video, then check that it holds the player's controls and that the layout filled the viewport. If either check fails, fall back to today's video-only promotion with native controls.

Not recommended: mirroring site captions into the overlay or a generated text track (option 3), and per-site adapters (option 4). Captions can't land as a separate feature: they come along with the player's own UI in both steps above, and the options that would add them on their own fail for the reasons in [Option 3](#option-3-mirror-site-captions). The hotkey side of captions is tracked in [#33](https://github.com/jaredbcook/media-hotkeys/issues/33) (native text tracks) and [#69](https://github.com/jaredbcook/media-hotkeys/issues/69) (custom players).

One decision needs the maintainer, because the only way to fully support YouTube's own watch page is per-site code. It is recorded in [#75](https://github.com/jaredbcook/media-hotkeys/issues/75), with a recommendation to accept video-only there.

## How it was tested

Throwaway Playwright scripts drove the built extension (`npm run build:chrome`) in Chromium with a persistent context, on a local fixture server plus real third-party pages and CDN-hosted players. Each page was checked with the shipped behavior (focus the video, press `t`) and with a prototype that applies the same kind of cascade-layer popover rules to a different element. Results were judged from screenshots and from DOM and box measurements. The prototypes were not committed.

- Playwright's Chromium cannot play the H.264 streams Vimeo serves, so the Vimeo embed was only observed with the iframe-only prototype in branded Chrome, which doesn't load the extension from the command line. The extension's own in-iframe promotion was observed on Vimeo only up to the player failing to start.
- Netflix and other DRM players can't be loaded in this setup. A fixture stands in: a video with a drawn caption element, a drawn control bar, and an unrelated ad panel beside the player.
- Not tested: menus and tooltips that a player renders in portals outside its container, and the interaction between a promoted container and the overlay or picture-in-picture. [#75](https://github.com/jaredbcook/media-hotkeys/issues/75) asks for the first to be checked.

## Results

Players: a plain `<video>` with a `<track>`, Video.js 8.23.4, Plyr 3.7.8, the YouTube and Vimeo embed iframes, the YouTube watch page, and the fixture above.

### Option 1: native controls only (current behavior)

| Player                         | Site controls                                                                                                                                                                                                | Captions                                                                                          | Timeline previews |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------- |
| Plain `<video>` with `<track>` | Native controls, including the browser's caption menu                                                                                                                                                        | **Kept.** The browser draws the cues on the video, so they stay with it                           | n/a               |
| Video.js                       | Gone; native controls shown instead                                                                                                                                                                          | **Lost.** Video.js moves the tracks off the element (`textTracks` is empty) and draws them itself | Gone              |
| Plyr                           | **Gone, and no native controls either**                                                                                                                                                                      | **Lost.** Track mode is `hidden` and Plyr draws the text itself                                   | Gone              |
| YouTube embed                  | Left behind: the iframe is enlarged, but the video inside it is promoted separately, so YouTube's title bar and CC and settings icons sit dimmed behind it                                                   | **Lost**                                                                                          | Gone              |
| Vimeo embed                    | Not verified. The player never started in the test browser, so the extension's behavior was only seen up to a loading state; the mechanism is the same as YouTube's (the child frame promotes its own video) | Not verified                                                                                      | Not verified      |
| YouTube watch page             | Gone; native controls shown                                                                                                                                                                                  | **Lost**                                                                                          | Gone              |
| Fixture                        | Gone; native controls shown                                                                                                                                                                                  | **Lost**                                                                                          | n/a               |

Plyr's stylesheet contains `.plyr--full-ui ::-webkit-media-controls { display: none }`, so the `controls` attribute that theater mode turns on has no visible effect there.

Native text tracks keep working in every case because the video stays the same element, so the caption toggle in [#33](https://github.com/jaredbcook/media-hotkeys/issues/33) is unaffected by whichever option is chosen.

### Option 2: promote the container

| Player                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video.js                       | **Works.** `.video-js` has the same box as the video. Controls, caption display, and the CC menu come along at full size                                                                                                                                                                                                                                                                                                                                         |
| Plyr                           | **Works**, but the walk up from the video kept going past `.plyr` into the page's own 640px wrapper, which had the same box. Harmless here; it shows that "same box as the video" can include page-owned wrappers                                                                                                                                                                                                                                                |
| Fixture                        | **Works.** The walk stopped at the player view because the ad panel made its parent larger. Controls and captions come along and the ad panel stays in the page                                                                                                                                                                                                                                                                                                  |
| Embed iframes (YouTube, Vimeo) | **Works with the iframe itself as the container**, so nothing needs detecting. YouTube showed its title bar, CC and settings, scrubber, and captions at full size; Vimeo showed its control bar, with captions, settings, speed, and picture-in-picture buttons (whether captions render was not tested)                                                                                                                                                         |
| YouTube watch page             | **Partly.** The video sits in a wrapper with no height (`.html5-video-container`), so a same-box walk needs a rule for zero-size wrappers. Promoting `#player` brought YouTube's controls, chapters, timeline preview thumbnails, and CC button, but the player kept its old 880x495 layout until the page received a `resize` event. After a synthetic one, the video measured 1216x684, offset 32px from the left with rounded corners, not filling the window |

What this says about the risks the issue lists:

- **Container detection.** A box comparison finds a working container on Video.js, Plyr, and the fixture. It needs rules for zero-size wrappers and a stopping point, and it can over-select a page's own wrapper. The verify step catches layout failures (YouTube) and containers with no controls in them. Three cases matter. A wrapper with the video's box that holds no controls (they sit in a sibling outside it) falls back, which is no worse than today. A wrapper that holds the controls but leaves the captions in a sibling passes the check and loses the captions, also no worse than today. An unrelated absolutely positioned element inside the same box comes along, which is accepted. The test cases for these are in [#75](https://github.com/jaredbcook/media-hotkeys/issues/75).
- **Site UI reacting to the resize.** YouTube's player lays itself out from page script, so it does not follow a container that was resized by CSS alone. Players built on CSS and `ResizeObserver` do. Faking a `resize` event runs unrelated page handlers, so it isn't recommended.
- **Unrelated content coming along.** Only content inside the wrapper comes along. The fixture's ad panel, a sibling that made the parent larger than the video, stayed behind. An overlay positioned inside the same box would come along; nothing tested did this.
- **Iframe trust checks.** Unchanged. Enlarging an iframe is the existing route-grant-or-focus flow. [#74](https://github.com/jaredbcook/media-hotkeys/issues/74) only stops the child frame from also promoting its own video.
- **No DOM moves and the top layer.** Both hold: the container is a manual popover in place, exactly as the video is today.

### Option 3: mirror site captions

Not recommended.

- There is no generic signal for "this element is the caption". In Video.js, over 10 seconds of playback, the time tooltip changed 95 times and the caption display 4 times; Plyr's time display changed 20 times and its caption element not at all, because its cue was static. A detector based on watching text change would have to tell captions from time displays and tooltips by position and styling, per player.
- A mirror also has to reproduce the caption's position, size, background, and window styling. Copied text in the overlay looks different from the site's captions and ignores the user's caption style settings.
- A generated text track needs cue timing, which DOM-drawn captions don't expose.
- Anything that finds the right element has already found the player's container, at which point promoting it is simpler and shows the real captions.

### Option 4: per-site or per-player handling

Not needed for the cases above. Of everything tested, only YouTube's own watch page would need it to get past the video-only fallback. The project has no per-provider adapters today (see [player-compatibility.md](player-compatibility.md)), so adding one is a decision for the maintainer, recorded in [#75](https://github.com/jaredbcook/media-hotkeys/issues/75).

## Risks to the theater mode design

- **No DOM moves.** Promoting a container keeps this invariant. The promoted element changes from the video to a wrapper, so code that treats the promoted element and the media as the same (`isTheaterMedia`, `getTheaterMedia` in `src/content/theater.ts`, and target scoring's theater signal) must keep pointing at the video.
- **Top-layer promotion.** Descendants stay inside the promoted container and are shown with it. Anything a player renders elsewhere in the document, such as menus and tooltips in `body` portals, would end up behind the top layer. This wasn't tested and is in the [#75](https://github.com/jaredbcook/media-hotkeys/issues/75) checklist.
- **Native `controls`.** They are added only because site controls stay behind. When a container or iframe is promoted they should not be added; when the fallback applies they still are.
- **Iframe trust checks.** `MEDIA_HOTKEYS_THEATER` still needs a route grant or a focused iframe. [#74](https://github.com/jaredbcook/media-hotkeys/issues/74) changes what the child does after it asks, not who may ask. Today the child promotes its own video regardless of the answer, and the parent never replies when it rejects the request (no grant or focus, fullscreen, or a failed `showPopover`), which is harmless because the video is enlarged either way. With iframe-only promotion a silent rejection, or one by any ancestor in a nested chain, would leave the child in theater mode with nothing enlarged, so the child needs an acknowledgment, sent back down hop by hop and accepted only from its immediate parent for a request it still has outstanding, and a fallback to promoting its video. It also needs its own theater state even when it promotes nothing, so exit from either side keeps unwinding both levels.
- **Cascade-layer sizing rules.** They would apply to any promoted element, so the selector can no longer assume `video` or `iframe`, and style injection already handles shadow roots.
- **Cases that stay as they are.** A video that doesn't fill its iframe (a page that happens to contain a video) keeps today's two-level promotion.
