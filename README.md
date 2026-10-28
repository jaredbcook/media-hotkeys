# Media Hotkeys

A browser extension that adds YouTube-style keyboard shortcuts to HTML `<video>` and `<audio>` on any website, including media inside iframes and shadow DOM.

Works in Chrome, Edge, and Firefox 128 or newer. Safari is possible by converting the Chrome build with Xcode.

## Features

- **Hotkeys for common media actions:** play/pause, mute, speed, volume, three skip sizes, restart, jump to a percentage, fullscreen, picture-in-picture, theater mode, and overlay toggle. Every key binding can be changed.
- **Picks the right media.** On pages with several videos, the extension targets the one you're using: fullscreen or focused first, then audible playback, then what you last clicked, then what's most visible. Muted looping videos without controls (hero backgrounds, hover previews) and videos hidden in collapsed menus or closed dialogs are ignored unless you interact with them, so the page keeps its keys.
- **Works through iframes and custom players.** Embedded players, shadow-DOM web components, and click-to-load thumbnails (pressing play activates them) are all supported.
- **Theater mode** fills the browser window with the video without going fullscreen.
- **On-screen feedback:** a brief overlay shows each action. It is optional and you can position it.
- **Per-site rules** let a site's own shortcuts win where you prefer them.
- **Settings sync** across devices through your browser's extension sync.

## Default hotkeys

Hotkeys only take effect when the page (or a frame inside it) has media to control. Elsewhere, keys keep their normal behavior, so arrow keys still scroll and a site's own shortcuts still work. On a page that scrolls, keys that scroll it (`ArrowUp`, `ArrowDown`, `Space`, `PageUp`, `PageDown`, `Home`, `End`) keep scrolling until you use a video: click or focus it, control it with another hotkey, or play it with sound while it's on screen. Hotkeys are also ignored while you type in a text field or other editable element, while Ctrl, Alt, or Meta is held, and on sites disabled by a site rule.

| Action                 | Key                 | Notes                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------- |
| Play/Pause             | `k`                 | Activates a click-to-play thumbnail if no media is loaded     |
| Mute/Unmute            | `m`                 |                                                               |
| Fullscreen             | `f`                 | `Esc` exits                                                   |
| Picture-in-Picture     | `i`                 | Not in Firefox, which has no picture-in-picture API for pages |
| Theater Mode           | `t`                 | Fills the window without fullscreen; `Esc` exits              |
| Speed Up               | `>`                 |                                                               |
| Slow Down              | `<`                 |                                                               |
| Volume Up              | `ArrowUp`, `+`, `=` |                                                               |
| Volume Down            | `ArrowDown`, `-`    |                                                               |
| Skip Forward (Small)   | `ArrowRight`        |                                                               |
| Skip Backward (Small)  | `ArrowLeft`         |                                                               |
| Skip Forward (Medium)  | `l`                 |                                                               |
| Skip Backward (Medium) | `j`                 |                                                               |
| Skip Forward (Large)   | `]`                 |                                                               |
| Skip Backward (Large)  | `[`                 |                                                               |
| Restart                | `r`                 | Jump to the beginning                                         |
| Toggle Overlays        | `o`                 | Turns the on-screen feedback on or off                        |
| Jump to Location       | `0`–`9`             | `0` jumps to 0%, `1` to 10%, and so on                        |

## Settings

Click the toolbar icon for **Quick Settings**: turn hotkeys on or off, rebind any action, and disable or enable the extension for the current site or section. **Advanced Settings** (the gear icon in Quick Settings, or the extension's Options page) holds everything else:

| Setting                          | Default        |
| -------------------------------- | -------------- |
| Min speed                        | 0.25x          |
| Max speed                        | 4x             |
| Speed increment                  | 0.25x          |
| Volume increment                 | 5%             |
| Small / medium / large skip      | 5s / 10s / 30s |
| Sum skips before overlay fadeout | On             |
| Number keys jump to location     | On             |
| Show overlays                    | On             |
| Overlay position                 | Center         |
| Skip back/forward position       | Left / right   |
| Overlay duration                 | 500ms          |
| Fade duration                    | 250ms          |
| Debug logging                    | Off            |

With **Sum skips** on, pressing skip repeatedly shows the running total (for example "+15s") instead of restarting the overlay each time.

### Site rules

Some sites, such as YouTube, have their own shortcuts. Add a site rule in Advanced Settings, or use the buttons in Quick Settings, to let the site's shortcuts win:

- A rule is a domain (`youtube.com`) or a path (`youtube.com/shorts`), and it either **disables** or **enables** Media Hotkeys there.
- More specific rules win. For example, disable `youtube.com` but enable `youtube.com/shorts`.
- Rules match the address of the page in the tab, including after a single-page app such as YouTube navigates without reloading. Embedded players inherit a disabled page's rule unless that rule's embeds setting is **ignore**.

## Install from source

The extension isn't published to browser stores yet. To build it, install [Node.js](https://nodejs.org/) 20 or newer, clone this repository, and run:

```sh
npm install
npm run build
```

Then load the build for your browser:

| Browser | Open                                    | Then                                                                                             |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Chrome  | `chrome://extensions`                   | Enable **Developer mode** → **Load unpacked** → select `dist/chrome`                             |
| Edge    | `edge://extensions`                     | Enable **Developer mode** → **Load unpacked** → select `dist/edge`                               |
| Firefox | `about:debugging#/runtime/this-firefox` | **Load Temporary Add-on…** → select `dist/firefox/manifest.json` (removed when Firefox restarts) |

## Privacy and permissions

Media Hotkeys makes no network requests and collects nothing. It requests `storage` (to save your settings, synced by your browser) and `activeTab` (so Quick Settings can show rules for the current site). To work on any page, it runs a content script in every page and frame. It has no host permissions beyond that.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow, and [ARCHITECTURE.md](ARCHITECTURE.md) for how the extension works.

## License

MIT. See [LICENSE](LICENSE).

[Material Icons](https://fonts.google.com/icons) by Google are used under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
