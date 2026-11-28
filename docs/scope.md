# Product scope and non-goals

Durable product boundaries and priorities for the extension. Read this before proposing new features, UI surfaces, or architectural shifts. Actionable work, priorities, and release sequencing live in GitHub Issues and Milestones—not in this file.

## Product model: a player-preserving control layer

The extension gives users consistent, customizable media controls across the web **without** replacing a site's media player. Rebuilding a full custom player interface across arbitrary websites creates a high-maintenance surface (auto-generated captions, chapters, timeline thumbnails, quality selectors, DRM/MSE quirks) that fights site UIs and bloats the extension.

Work fits into three tiers:

1. **Invisible input layer (default).** Consistent keyboard shortcuts and opt-in mouse ergonomics (such as double-click fullscreen or scroll-wheel adjustments) that drive the site's existing media element or host API without altering its UI.
2. **Non-destructive layout modes (theater, fullscreen, picture-in-picture).** Enlarge or pop out media while keeping the site's own controls and captions whenever possible (promoting player iframes or verified containers, as evaluated in [theater-controls.md](theater-controls.md)), falling back to native browser controls only when container promotion cannot work.
3. **Minimal fallback controls (opt-in / exception only).** Lightweight controls only when a site exposes no usable controls of its own (for example, raw `<video>` elements or short-form feeds without a scrubber), never replacing full site players such as YouTube, Vimeo, or Video.js.

## Prioritized goals

When trade-offs arise, higher-ranked goals take precedence:

1. **Great playback experience across as many sites as possible**, including embedded media (iframes), shadow DOM, and custom players.
2. **Deep, granular user customization**—both for personal preference and to avoid breaking site-specific features a user wants to keep (such as social-media shortcuts, site theater modes, or custom captions).
3. **Respect web, browser, and accessibility standards**—focus navigation (`Tab`), interactive control activation (`Space`, `Enter`), ARIA widgets, scroll conventions, `prefers-reduced-motion`, and keyboard accessibility.
4. **Support major browsers**—Chrome, Edge, and Firefox as first-class MV3 targets, with Safari supported via conversion.
5. **Stay lightweight while full-featured**—minimal content-script footprint, no background service worker unless strictly required, and zero tracking or network requests.
6. **Modern, maintainable engineering**—clean TypeScript, automated tests, strict invariants, and concise documentation usable by both human contributors and AI coding agents.
7. **Clean, systemic design with free or original assets**—consistent tokens across settings and overlays, using open-licensed or original icons.

## Explicit non-goals

Do not add features in these categories without a maintainer decision to revise this document:

- **Full replacement media player skins** or per-site visual restyling of existing players.
- **Audio/video post-processing** (color filters, brightness/contrast shaders, graphic equalizers, pitch shifting).
- **Ad blocking or ad skipping** (belongs in dedicated content blockers).
- **AI features, cloud accounts, telemetry, or network calls** (the extension stays 100% local and relies on browser-native settings sync).
- **Site-specific scraping or per-provider SDK injection** (see [player-compatibility.md](player-compatibility.md)).
