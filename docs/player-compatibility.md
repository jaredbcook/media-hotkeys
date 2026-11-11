# Player compatibility notes

Research notes on how common web video players are built. This is the background behind the custom-player design in [ARCHITECTURE.md](../ARCHITECTURE.md#custom-players). These are observations about third-party players, not guarantees, so re-check a player before relying on a row.

## Player landscape

| Player / tech                              | Common shape                                            | Direct `<video>`/`<audio>` control                                                                        |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| YouTube                                    | Cross-origin iframe, IFrame API                         | Only from inside the iframe document; the provider API exposes play, pause, seek, volume, mute, and rate. |
| Vimeo                                      | Cross-origin iframe, Player SDK                         | Usually not from the parent page; the SDK exposes play, pause, time, volume, rate, fullscreen, and PiP.   |
| TikTok embed                               | Provider embed or iframe                                | Low confidence; treat as provider-owned.                                                                  |
| MediaElement.js                            | Custom UI over HTML5 media                              | Usually works when the underlying media element is reachable.                                             |
| Video.js                                   | Custom UI over native media; newer Web Component work   | Usually works for native-backed players; Web Component hosts may also expose host APIs.                   |
| Wistia                                     | Aurora `<wistia-player>` Web Component; iframe fallback | Often works; host APIs are preferred when reachable, for state sync.                                      |
| Brightcove                                 | Hosted player with Video.js lineage                     | Often works; player APIs are safer for ads, analytics, and UI state.                                      |
| JW Player                                  | Custom JavaScript player                                | Often works after setup; JW Player has its own play, pause, seek, mute, and volume APIs.                  |
| SoundCloud                                 | Provider iframe/audio embed                             | Usually provider-owned; media may not be reachable from the parent page.                                  |
| Vidyard / Loom                             | Provider iframe/player SDK                              | Usually iframe-owned; frame-local discovery may help when accessible.                                     |
| Flowplayer / Plyr / Fluid Player / DPlayer | Custom controls over native media                       | Usually works unless wrapping YouTube or Vimeo embeds.                                                    |
| dash.js / hls.js / Shaka                   | Streaming engines attached to native media, optional UI | Works; these attach to a real media element.                                                              |
| Kaltura / Dailymotion / Twitch             | Provider iframe/player SDK                              | Usually iframe-owned; frame-local discovery may help when accessible.                                     |
| Bitmovin / THEOplayer                      | Commercial custom players                               | Mixed; direct media may work, but player APIs are more semantically correct.                              |

## What this means for the extension

- **Provider iframes** are reached by the content script running inside the iframe (`all_frames`), not by provider APIs. No SDKs are injected and there are no per-provider adapters.
- **Native-backed custom UIs** work through direct `HTMLMediaElement` control, which remains the fallback for every action.
- **Web Component hosts** in open shadow roots are driven through host APIs, via `src/player-bridge.ts` in the main world, before falling back to the media element.
- **Best-effort only:** closed shadow roots, cross-origin frames the browser won't inject into, blocked autoplay, and player API failures. These fail silently to the user and fall back where possible.

References: Chrome [`content_scripts.world`](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts), MDN [`content_scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts).

## Not yet supported

- **Closed captions on custom players.** The captions hotkey (`c`) switches native `<track>` captions and subtitles through the `TextTrack` API. Sites like YouTube, Vimeo, and Twitch draw their own caption UI and have no text track on the `<video>`, so `c` stays with the page there and the site's own shortcut handles it. Reaching those players' caption state is researched in [#69](https://github.com/jaredbcook/media-hotkeys/issues/69). Players that keep a caption track in `hidden` mode so they can read its cues and draw them (Plyr and Video.js do) are treated the same way; one that leaves its tracks `disabled` while captions are off looks like a native player and loses the key.
- **Site controls and captions in theater mode.** Theater mode promotes only the `<video>`, so a custom player's own controls and captions stay behind. See [theater-controls.md](theater-controls.md) for how each player behaves and the planned changes.
