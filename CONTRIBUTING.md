# Contributing

Setup, workflow, and conventions for working on Media Hotkeys. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing behavior. AI coding agents should also follow [AGENTS.md](AGENTS.md).

## Setup

Requires Node.js 24+ and npm.

```sh
npm install        # also installs the Husky pre-commit hook
npm run build      # unpacked extensions in dist/chrome, dist/edge, dist/firefox
```

Load `dist/<browser>` in your browser as described in [README.md](README.md#install-from-source). After rebuilding, reload the extension from the browser's extensions page and refresh the pages you're testing.

## Commands

| Command                                      | What it does                                                         |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `npm run check`                              | Format check, lint, typecheck, and unit/UI tests (the commit gate)   |
| `npm run build`                              | Build Chrome, Edge, and Firefox into `dist/`                         |
| `npm run build:chrome` (`:edge`, `:firefox`) | Build one browser                                                    |
| `npm test` / `npm run test:watch`            | Vitest unit and UI tests                                             |
| `npm run test:e2e`                           | Playwright end-to-end tests (run `npm run build:chrome` first)       |
| `npm run typecheck`                          | `tsc` for app code, unit/UI tests, scripts, configs, and E2E tests   |
| `npm run lint`                               | ESLint                                                               |
| `npm run lint:firefox`                       | `web-ext lint` on `dist/firefox` (run `npm run build:firefox` first) |
| `npm run format` / `npm run format:check`    | Prettier, including Markdown docs                                    |
| `npm run package`                            | Build and zip all browsers into `dist/packages/`                     |
| `npm run safari:convert`                     | macOS only: print the Xcode Safari conversion command                |
| `npm run labels:sync`                        | Create or update the GitHub issue labels (needs `gh`)                |

The pre-commit hook refuses commits on `main` and runs `npm run check`. CI (`.github/workflows/ci.yml`) runs the same checks, builds every browser, lints the Firefox build with `web-ext lint`, and runs the E2E suite on Chromium.

## Testing

| Suite | Location                                                  | Runner               | Use for                                                     |
| ----- | --------------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| Unit  | `tests/unit/{content,overlay,storage,scripts,docs}/`      | Vitest + jsdom       | Logic in `src/` and `scripts/`, plus doc consistency        |
| UI    | `tests/ui/{quick-settings-popup,advanced-settings-page}/` | Vitest + jsdom       | Settings popup and options page behavior                    |
| E2E   | `tests/e2e/{shortcuts,settings}/`                         | Playwright, Chromium | Real keypresses against real media with the built extension |

- `webextension-polyfill` is mocked with `vi.mock` in unit and UI tests; reuse the `helpers.ts` in each folder rather than writing new mocks.
- jsdom has no layout, media playback, or Popover API. Tests stub these explicitly (see `mockRect` in `tests/unit/content/helpers.ts` and the popover stub in `theater-mode.test.ts`). Anything that depends on real layout, focus, or playback needs an E2E test.
- E2E tests load `dist/chrome`, so **rebuild before running them**. They run with one worker because the extension context is shared. Page fixtures and media helpers are in `tests/e2e/setup.ts` and `tests/e2e/fixtures.ts`.
- Coverage thresholds (80%) are configured in `vitest.config.ts`; run `npx vitest run --coverage` to check them.

## Debugging

- Turn on **Debug Logging** in Advanced Settings. The content script then logs matched keys, handled actions, tracked interactions, placeholder scans, and theater-mode failures to each frame's DevTools console via `debugLog` in `src/content/dom-utils.ts`.
- The build isn't minified, so `dist/<browser>/content.js` is readable in DevTools.
- To debug cross-frame behavior, pick the iframe's context in the DevTools console dropdown. Each frame runs its own content script.

## Issues and pull requests

GitHub issues are the task list, for people and AI agents alike. Every change reaches `main` through a pull request; the pre-commit hook refuses commits on `main`.

1. **Find work.** Pick an open issue labeled `ready` that isn't `in progress`. Issues labeled `needs triage` or `blocked`, or without `ready`, wait for the maintainer.
2. **Claim it.** Add the `in progress` label. That label alone means the issue is taken. If an issue has been `in progress` for a day with no linked pull request, anyone may remove the label and claim it.
3. **Branch.** Start from an up-to-date `main`, on a branch or a worktree named `<type>/<issue>-<slug>`, for example `fix/42-altgr-brackets`.
4. **Open a draft pull request early** with `Closes #<issue>` in the description, so the issue shows its work is underway. Keep it to that one issue.
5. **Finish.** Run the checks for what you changed, fill in `.github/pull_request_template.md`, and mark the pull request ready for review. Merging (squash) closes the issue.

**File what you find.** A bug, risk, or recommended change outside the issue you're working on becomes a new issue rather than a fix slipped into your pull request. Search open issues first, then file it from a template in `.github/ISSUE_TEMPLATE/` (bug report or change). New issues start as `needs triage` until the maintainer marks them `ready`. Report security problems privately as described in [SECURITY.md](SECURITY.md).

Labels and their meanings are defined in `scripts/sync-labels.ts`; `npm run labels:sync` creates or updates them on GitHub.

### Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `build:`. Write the subject in the imperative, lower case, without a trailing period.
- Keep each commit focused, and include its tests and doc updates in the same commit.
- Don't commit `dist/`, `coverage/`, or test output.

## Keeping docs current

Each fact has one home. Update that file in the same change that alters the behavior, and link to it from elsewhere instead of copying it.

| Change                                                                  | Update                                    |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| User-visible behavior, default hotkeys or settings, install steps       | `README.md`                               |
| Module responsibilities, design decisions, invariants, new `src/` files | `ARCHITECTURE.md`                         |
| Commands, tooling, test layout, workflow                                | `CONTRIBUTING.md`                         |
| Rules and recipes for AI agents                                         | `AGENTS.md` (`CLAUDE.md` only imports it) |
| Third-party player research                                             | `docs/player-compatibility.md`            |

`tests/unit/docs/docs-consistency.test.ts` runs with `npm test` and fails when:

- a `src/` file is missing from the ARCHITECTURE.md code map
- a default key or setting in `src/settings/defaults.json` disagrees with README.md
- a doc references an `npm run` script that doesn't exist
- a relative link in a doc points to a missing file

## Releasing

1. On a branch, bump `version` in `package.json`. Built manifests take their version from it.
2. Run `npm run check`, then `npm run build:chrome && npm run test:e2e`.
3. Run `npm run package` and smoke-test each archive in `dist/packages/`.
4. Merge the version bump through a pull request, then tag the merged commit on `main` and push the tag: `git switch main && git pull && git tag vX.Y.Z && git push origin vX.Y.Z`. The tag must match the `package.json` version, or CI fails.
5. CI runs the full test suite, packages every browser, and creates a GitHub Release for the tag with the archives attached and notes generated from the commits since the last tag. Edit the notes on the release page if needed.
6. Upload the archives from the release to each browser store. Stores reject a version they have already seen, so every upload needs a new version.
7. addons.mozilla.org also requires the source code, because the Firefox build is bundled by Vite. Upload an archive of the tagged commit as the source code: `git archive --format=zip -o media-hotkeys-source-vX.Y.Z.zip vX.Y.Z`. In the reviewer notes, say that it builds with Node.js 24 and `npm ci && npm run build:firefox`, which writes the extension to `dist/firefox`.

The Firefox package on the release, `media-hotkeys-firefox-vX.Y.Z-unsigned.xpi`, is unsigned. Firefox only installs it permanently after Mozilla signs it through addons.mozilla.org.

### Safari

Safari isn't part of the default build, package, or CI path. On macOS with Xcode:

```sh
npm run build:chrome
npm run safari:convert   # prints the xcrun safari-web-extension-converter command to run
```
