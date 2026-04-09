# Media Hotkeys Extension

Browser extension that adds hotkeys to control HTML video or audio on any website.

## Development Build Targets

- Chrome
- Edge
- Firefox
- Safari via a separate macOS/Xcode conversion step from the Chrome build

## Features

- **Hotkeys for common media actions**: Play/pause, mute, playback speed, skip forward/backward, restart, jump-to-percent, volume, fullscreen, picture-in-picture, and overlay toggling.
- **Visual feedback**: If enabled, shows a temporary overlay for most actions.
- **Smart selection**: Automatically selects the best media element to control even if it doesn't have focus (for example, annoying auto-playing videos).
- **Cross-origin support**: Works with media embedded in iframes or in the shadow DOM.
- **Grouped settings**: Quick settings cover the global enabled toggle and action key bindings, while advanced settings cover playback, skip, overlay, and debugging behavior.
- **Settings sync**: Syncs your extension settings between devices that have the extension installed (must be signed in and have extension sync enabled).

## Default Hotkeys

Note: Hotkeys are ignored if focus is on a text input or other editable element.

| Action                 | Key                 | Notes                                            |
| ---------------------- | ------------------- | ------------------------------------------------ |
| Play/Pause             | `k`                 |                                                  |
| Mute/Unmute            | `m`                 |                                                  |
| Fullscreen             | `f`                 | `Esc` exits fullscreen                           |
| Picture in Picture     | `i`                 |                                                  |
| Speed up               | `>`                 | Default maximum is 4x. Default step is 0.25x.    |
| Slow down              | `<`                 | Default minimum is 0.25x. Default step is 0.25x. |
| Volume up              | `ArrowUp`, `+`, `=` | `ArrowUp` only works when media has focus\*      |
| Volume down            | `ArrowDown`, `-`    | `ArrowDown` only works when media has focus\*    |
| Skip forward (small)   | `ArrowRight`        | Default is 5 seconds                             |
| Skip backward (small)  | `ArrowLeft`         | Default is 5 seconds                             |
| Skip forward (medium)  | `l`                 | Default is 10 seconds                            |
| Skip backward (medium) | `j`                 | Default is 10 seconds                            |
| Skip forward (large)   | `]`                 | Default is 30 seconds                            |
| Skip backward (large)  | `[`                 | Default is 30 seconds                            |
| Restart                | `r`                 | Restart from the beginning                       |
| Toggle overlays        | `o`                 | Switches visual feedback on or off               |
| Jump to location       | `0`–`9`             | `0` jumps to 0%, `1` to 10%, etc.                |

\*By default, arrow keys cause the page to scroll if no interactive element has focus.

## Settings Model

### Quick Settings

- Global hotkeys enabled toggle
- Action key bindings

### Advanced Settings

| Setting                             | Default Value |
| ----------------------------------- | ------------- |
| Playback speed minimum              | 0.25x         |
| Playback speed maximum              | 4x            |
| Playback speed increment amount     | 0.25x         |
| Skip step size (small/medium/large) | 5s/10s/30s    |
| Volume step size                    | 5%            |
| Overlay visibility                  | All actions   |
| Overlay position                    | Center        |
| Overlay visible time                | 500ms         |
| Overlay fade duration               | 250ms         |

## Installation — Chrome (Developer Mode)

1. Clone or download this repository.
2. Run `npm install`.
3. Run `npm run build:chrome`.
4. Open Chrome and go to `chrome://extensions/`.
5. Enable **Developer mode** in the top right corner.
6. Click **Load unpacked**.
7. Select `dist/chrome`.

## Installation — Edge (Developer Mode)

1. Clone or download this repository.
2. Run `npm install`.
3. Run `npm run build:edge`.
4. Open Edge and go to `edge://extensions/`.
5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select `dist/edge`.

## Installation — Firefox (Temporary Add-on)

1. Clone or download this repository.
2. Run `npm install`.
3. Run `npm run build:firefox`.
4. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
5. Click **Load Temporary Add-on...**.
6. Select the generated manifest at `dist/firefox/manifest.json`.

Firefox temporary add-ons are removed when the browser restarts. For release packaging, use `npm run package:firefox` to generate the Firefox archive in `dist/packages/`.

## Release Workflow

Use the Node 20 + npm workflow from [DEVELOPMENT.md](DEVELOPMENT.md):

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run package
```

Safari packaging is not part of the default release path. Convert the Chrome build separately on macOS with `npm run safari:convert`.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Third-Party Assets

- **Material Icons** by Google are used under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
