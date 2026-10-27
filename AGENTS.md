# AGENTS.md

Instructions for AI coding agents working on Media Hotkeys, a Manifest V3 browser extension (TypeScript, Vite, Vitest, Playwright) that adds keyboard shortcuts for HTML media on any site.

## Where things are documented

Read the relevant doc before you change code. Each fact lives in one file, so link to it rather than copying.

- [ARCHITECTURE.md](ARCHITECTURE.md): code map, how target selection, cross-frame arbitration, placeholders, theater mode, and settings work, and the **invariants**
- [CONTRIBUTING.md](CONTRIBUTING.md): commands, test layout, debugging, commit style, release
- [README.md](README.md): user-facing behavior, default hotkeys and settings
- [docs/player-compatibility.md](docs/player-compatibility.md): third-party player research

## Verify your work

`npm run check` runs format check, lint, typecheck, and unit/UI tests. It is also the pre-commit hook. Add more depending on what you touched:

| You changed                                                                                            | Also run                                                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `src/content/**`, `src/content.ts`, `src/overlay.ts`, `src/player-bridge.ts`, `manifest.template.json` | `npm run build:chrome && npm run test:e2e`                          |
| Settings UI (`src/*settings*`, `src/ui.css`)                                                           | `npm run build:chrome && npm run test:e2e` (`tests/e2e/settings/`)  |
| `scripts/**`, `vite.config.ts`                                                                         | `npm run build`                                                     |
| Docs only                                                                                              | `npm run format:check && npm test` (runs the docs consistency test) |

E2E tests load `dist/chrome`, so always rebuild before running them. Run `npm run format` to fix formatting rather than hand-editing whitespace. Never report a check as passing without running it.

## Rules

These aren't caught by tests unless marked. ARCHITECTURE.md#invariants explains why each one matters.

- Use `webextension-polyfill` for extension APIs, never `chrome.*` (enforced by `tsc`).
- Manifest V3 only. Don't add `host_permissions`, new `permissions`, or a background script without asking first.
- Hotkeys must stay suppressed in editable elements, including inside shadow roots, and while Ctrl, Alt, or Meta is held.
- Never call `preventDefault` on a key unless `hasPotentialTarget` in `src/content/media-presence.ts` allows it. Pages without media keep their keys. Media that only appears asynchronously in another frame must be reported through the presence messages.
- Exactly one frame executes a media action. New cross-frame behavior goes through the score/execute protocol in `src/content/frame-messaging.ts`, not ad-hoc broadcasts.
- Keep the trust checks on `MEDIA_HOTKEYS_THEATER` and the no-navigation guard in `placeholder.ts`. They block security and UX regressions.
- `src/player-bridge.ts` runs in the page's main world. Keep it import-free and whitelist-only.
- Don't add generic button clicking for custom players. Only play buttons are clicked.
- Shared content-script state goes in `src/content/state.ts`. State used by one module stays module-private. Plain module state, no classes.
- Named exports only in `src/`. TypeScript strict mode.
- Never write to `storage.sync` directly. Use `saveSettings` from `src/storage.ts`, which normalizes and migrates.
- Safari is not a build target. Never add it to the default build, package, or CI path.
- Don't commit `dist/`. Built manifests take `version` from `package.json`, so never set it in `manifest.template.json`.

## Recipes

### Add a hotkey action

1. Add it to `MediaAction` in `src/storage.ts`. If it isn't user-configurable, also exclude it from `ConfigurableMediaAction`.
2. Add a default binding in `src/settings/defaults.json` under `quickSettings.actionKeyBindings`.
3. Add a case to the `switch` in `handleAction` in `src/content/actions.ts`. Read and write media through `src/content/player-control.ts` so custom players keep working. Actions not tied to a media element (like `toggleOverlays`) go through `isGlobalAction` and `handleGlobalAction` in `src/content/dispatch.ts` instead.
4. For an overlay, add an icon in `src/icons.ts` and a case in `buildContent` in `src/overlay.ts`. If the action should show no overlay, add it to `NON_OVERLAY_ACTIONS` in `src/storage.ts`.
5. Add a label to `ACTION_LABELS` in `src/quick-settings-popup.ts` (`tsc` requires one for every configurable action).
6. Add tests in `tests/unit/content/` and E2E coverage in `tests/e2e/shortcuts/`.
7. Add a row to the README hotkey table. The docs consistency test fails until you do.

### Add a setting

1. Add the default in `src/settings/defaults.json` and the type in `src/storage.ts`. Handle migration in `normalizeSettings` if the shape changes.
2. Add the control to the popup or the advanced page (`*.html`, `*.ts`; advanced form helpers are in `src/advanced-settings.ts`).
3. Read it from `state.settings` in the content script or from the settings passed to `src/overlay.ts`.
4. Add tests in `tests/unit/storage/` and `tests/ui/<surface>/`.
5. Add it to the README settings table. The docs consistency test fails until you do.

## Gotchas

- Every frame runs its own content script. A page's video may live in a cross-origin iframe the top frame can't see.
- Media appears late (SPAs, lazy embeds, shadow roots attached after load). Detection must work with the mutation observer in `src/content/media-tracking.ts`, which also patches `attachShadow`.
- Pages often have many media elements (ads, previews, background loops). Test target selection with multi-media pages, not a single video.
- jsdom has no layout, playback, or Popover API. Unit tests stub them, so behavior that depends on them needs an E2E test.

## Keeping docs current

Docs are part of the change, not a follow-up. Before you finish:

- New, renamed, or deleted `src/` file: update the ARCHITECTURE.md code map.
- Changed design, protocol, or invariant: update the matching ARCHITECTURE.md section.
- Changed defaults, hotkeys, or user-visible behavior: update README.md.
- Changed commands, scripts, tooling, or test layout: update CONTRIBUTING.md and the verification table above.
- Learned something an agent would repeatedly get wrong: add it here, briefly.

`tests/unit/docs/docs-consistency.test.ts` catches the mechanical drift: code map coverage, README defaults, `npm run` references, and relative links. Prose accuracy is your job.
