# Disable the entry import map for browser startup

**Decision:** Disable Nuxt's entry-import-map optimization (`entryImportMap: false`). Keep server rendering, hydration, and SSR streaming enabled.

## Why

An import map translates a module alias such as `#entry` into a file URL. The historical investigation attributed the Firefox failure to HTTP module-preload headers causing Firefox to encounter that alias before the entry import map was registered. Disabling this optimization switched startup to direct chunk imports.

**Historical observation (reported 2026-09-26):** A clean Firefox session showed server-rendered HTML but did not hydrate; search and comparison remained non-interactive, the console reported an unresolved `#entry` / `NUXT_E1005`, and no API requests were made. The report says direct chunk imports restored interaction. Later historical checks reported Firefox and Chromium search/comparison flows working locally and on a remote preview. These are dated observations, not a fresh reproduction or a guarantee for future framework/browser versions.

The owner accepted retaining this compatibility fix. A visible server-rendered page or a successful API check is not sufficient proof of a functioning application.

## Costs and limits

- We forgo this particular Nuxt optimization, not all module preloading or SSR streaming.
- The reviewed artifacts do not establish a measured performance penalty or that every future Nuxt/Firefox version needs the workaround.
- Browser interaction must be checked, not just HTML output, compilation, or API responses.

Reconsider after relevant framework/browser changes, using actual Firefox and Chromium search, navigation, and direct-reload checks. Remove the workaround only when startup with the optimization enabled is shown to work.

## Artifacts

- [Nuxt configuration](../../../nuxt.config.ts): source evidence for the current flags.
- [Release verification policy](../ops/releases-and-recovery.md#verification-and-release-evidence): current browser-check requirements.
