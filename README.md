# Media Hotkeys Extension

Browser extension that adds hotkeys to control HTML video or audio on any website.

## Development Build Targets

- Chrome
- Firefox
- Safari via a separate macOS/Xcode conversion step from the Chrome build

## Features

- **Hotkeys for common media actions**: Play/pause, mute, playback speed, skip forward/backward, volume, fullscreen, picture-in-picture.
- **Visual feedback**: If enabled, shows a temporary overlay for most actions.
- **Smart selection**: Automatically selects the best media element to control even if it doesn't have focus (for example, annoying auto-playing videos).
- **Cross-origin support**: Works with media embedded in iframes or in the shadow DOM.
- **Customizable settings**: Adjust min/max playback speed, increments for volume and playback adjustments, visibility and placement of visual indicators, etc.
- **Site-specific settings**: Allows custom settings for different sites so you can avoid conflicting hotkeys.
- **Settings sync**: Syncs your extension settings between devices that have the extension installed (must be signed in and have extension sync enabled).

## Default Hotkeys

Note: Hotkeys are ignored if focus is on a text input or other editable element.

| Action                 | Key                 | Notes                                            |
| ---------------------- | ------------------- | ------------------------------------------------ |
| Play/Pause             | `k`                 |                                                  |
| Mute/Unmute            | `m`                 |                                                  |
| Fullscreen             | `f`                 | `Esc` exits fullscreen                           |
| Picture in Picture     | `i`                 |                                                  |
| Volume up              | `+`, `=`, `ArrowUp` | `ArrowUp` only works when media has focus\*      |
| Volume down            | `-`, `ArrowDown`    | `ArrowDown` only works when media has focus\*    |
| Skip forward (small)   | `ArrowRight`        | Default is 5 seconds                             |
| Skip backward (small)  | `ArrowLeft`         | Default is 5 seconds                             |
| Skip forward (medium)  | `l`                 | Default is 10 seconds                            |
| Skip backward (medium) | `j`                 | Default is 10 seconds                            |
| Skip forward (large)   | `]`                 | Default is 30 seconds                            |
| Skip backward (large)  | `[`                 | Default is 30 seconds                            |
| Speed up               | `>`                 | Default maximum is 4x. Default step is 0.25x.    |
| Slow down              | `<`                 | Default minimum is 0.25x. Default step is 0.25x. |
| Jump to location       | `0`–`9`             | `0` jumps to the beginning, `1` to 10%, etc.     |
| Restart                | `r`                 | Same as jump to location `0`                     |

\*By default, arrow keys cause the page to scroll if no interactive element has focus.

## Configurable Settings

| Setting                             | Default Value |
| ----------------------------------- | ------------- |
| Playback speed minimum              | 0.25x         |
| Playback speed maximum              | 4x            |
| Playback speed increment amount     | 0.25x         |
| Skip step size (small/medium/large) | 5s/10s/30s    |
| Volume step size                    | 5%            |
| Overlay visibility                  | All actions   |
| Overlay position                    | Center        |
| Overlay opacity                     | 70%           |
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
