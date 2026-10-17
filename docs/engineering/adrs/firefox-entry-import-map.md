# Disable the entry import map for browser startup

**Decision:** Disable Nuxt's entry-import-map optimization (`entryImportMap: false`). Keep server rendering, hydration (activating the rendered page in the browser), and SSR streaming enabled.

## Why

An import map translates a module alias such as `#entry` into a file URL. The historical investigation attributed the Firefox failure to HTTP module-preload headers. They caused Firefox to encounter the alias before the entry import map was registered. Disabling this optimization changed startup to import chunks directly.

**Historical observation (reported 2026-09-26):** A clean Firefox session showed server-rendered HTML but did not hydrate. Search and comparison stayed non-interactive. The console reported an unresolved `#entry` / `NUXT_E1005`, and no API requests were made.

The report says direct chunk imports restored interaction. Later historical checks reported working Firefox and Chromium search/comparison flows, locally and on a remote preview. These are dated observations, not a fresh reproduction or a guarantee for future framework/browser versions.

The owner accepted keeping this compatibility fix. A visible server-rendered page or successful API check does not prove that the application works.

## Costs and limits

- This gives up one Nuxt optimization, not all module preloading or server-side rendering (SSR) streaming.
- The reviewed artifacts do not establish a measured performance penalty. They also do not show that every future Nuxt/Firefox version needs the workaround.
- Check browser interaction, not just HTML output, compilation, or API responses.

Reconsider after relevant framework/browser changes. Check real Firefox and Chromium search, navigation, and direct reloads. Remove the workaround only after startup works with the optimization enabled.

## Artifacts

- [Nuxt configuration](../../../nuxt.config.ts): source evidence for the current flags.
- [Release verification policy](../ops/releases-and-recovery.md#verification-and-release-evidence): current browser-check requirements.
