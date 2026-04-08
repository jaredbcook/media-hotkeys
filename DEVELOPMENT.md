# Development

## Prerequisites

- Node.js 20
- npm

## Setup

```sh
npm install
```

## Build

```sh
# Build supported browsers
npm run build

# Build for a specific browser
npm run build:chrome
npm run build:firefox
```

`npm run build` generates unpacked extensions in `dist/chrome/` and `dist/firefox/`.

## Test

```sh
# Typecheck app code and typed tooling
npm run typecheck

# Lint
npm run lint

# Unit tests
npm test

# End-to-end tests against the Chrome build
npm run build:chrome
npm run test:e2e
```

## Package for release

```sh
npm run package
npm run package:chrome
npm run package:firefox
```

Packages are written to `dist/packages/`.

## Safari Conversion

Safari is not part of the standard Linux CI or default local build/package workflow.

On macOS, build the Chrome extension first and then run:

```sh
npm run build:chrome
npm run safari:convert
```

The `safari:convert` command prints the `xcrun safari-web-extension-converter` invocation to run from the repository root.
