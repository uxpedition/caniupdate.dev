# Progressive comparison loading — declarations first, measurements after

**Date:** 2026-09-22
**Status:** Design proposal. Direction approved on 2026-09-22: trim the comparison payload, split declarations from measurements, then add streaming SSR. This document does not authorize implementation until the implementation plan is written and approved.

## 1. Problem

The comparison page shows one sentence — “Reading package declarations and published evidence…” — until a single response carrying every fact arrives, then renders everything at once. The page has no server-side data path, so that sentence is also what the server sends (3.2 KB of HTML), and nothing else can render until the client downloads JavaScript, hydrates, and completes a request.

Measured on the production build (`nub run build`, `node .output/server/index.mjs`, 2026-09-22):

| Measurement | Result |
| --- | --- |
| SSR HTML for `/lodash/4.17.20...4.17.21` | 0.50 s TTFB, 3.2 KB, only the loading sentence and URL-derived version strings |
| Client JS | 544 KB raw across chunks (largest 124 KB) |
| `GET /compare`, cold process | 0.98 s; **293,657 B uncompressed** JSON |
| `GET /compare`, cold, Fast 3G (1.6 Mbps / 150 ms), browser | 4,039 ms transfer; facts visible at **4.29 s** |
| `GET /compare/briefing`, cold (glm-5.3-flash) | 20,169 ms; notes visible at 24.5 s |
| Both endpoints, warm | ~4 ms |
| Payload composition (lodash) | tarball file inventory **265 KB of 293 KB** |
| Same facts with inventory and changelog bodies removed | 28,242 B raw, 2,993 B gzip |

Three independent causes:

1. **The response carries data no consumer reads.** The client uses `tarball.status`, `files.length`, and `changelogs.length` only (`comparisonView.ts`, `comparisonSummary.ts`). Per-file `path`/`size`/`sha256` entries, changelog bodies, and `releaseNotes` are shipped but never rendered; `releaseNotes` is not referenced anywhere in `app/`. Under Fast 3G the transfer alone costs ≈1.4 s.
2. **One slow provider gates every row.** `getComparisonFacts` resolves manifests, tarballs, OSV, Bundlephobia, and GitHub release notes together. Measured per provider: registry manifest 0.06–0.08 s, tarball 0.13 s, OSV batch 0.54 s plus ~0.37 s per detail wave (concurrency 5), GitHub release notes ~0.37 s, Bundlephobia 0.25 s when rate-limited (`429` observed from this network) and up to its 30 s deadline when it must build. Eight of the thirteen rows, plus the dependencies tile, need manifests only.
3. **Rendering is all-or-nothing.** Every section sits behind `v-else-if="comparisonData"` in `app/pages/[packageName]/[versionPair].vue`, and there is no streaming, so the first paint cannot contain facts even when they are already available on the server.
4. **The server already pays for the full evidence collection and throws it away.** TanStack Query's observer fetches on subscribe, so during SSR the comparison query runs to completion server-side, and because pending queries are excluded from `dehydrate` (`defaultShouldDehydrateQuery` requires `status === 'success'`), the render never waits for it and the payload carries nothing. Verified on the built server: after a single page request, `GET /compare` for that pair answers in 3.5 ms, while a server that never served a page needs 806 ms. The client then repeats the request. The design below makes that already-paid work the first paint instead of discarding it — and must gate the measurements and briefing queries to the client, because awaiting declarations during SSR would otherwise enable them and trigger provider and model calls on the server.

The agreed product plan already states the intended behavior: “Render factual sections immediately: each branch has independent loading, available, partial or unavailable state” and “Show calculated results as soon as they are ready” (`2026-09-16-package-upgrade-design.md` §4–§5). The current single-response gate violates that principle; this design restores it for the two tiers that matter on the page.

## 2. Required behavior

Decisions taken on 2026-09-22:

- Declarations (manifest-derived rows) must be in the first paint.
- Measurements (sizes, advisories, tarball inspection) and AI notes fill in afterwards, client-side, without user action.
- No fabricated values while pending: a pending row or tile is labeled, never zero-filled or blank.
- Release notes are maintainer evidence for AI inference only (decision 2026-09-22). They are collected server-side for the briefing prompt and surface to users solely as cited `maintainer` sources and `basis: maintainer` bullets. No page section renders them, and no route returns them to the browser.

Streaming SSR is enabled to get the shell and declarations into the first paint; crawlers keep receiving a complete declarations render because Nuxt disables streaming for bot user agents. Crawler completeness for measurements is explicitly not required. No SEO metadata work is in scope.

## 3. Approaches considered

| Approach | Trade-offs | Decision |
| --- | --- | --- |
| **Two endpoints**: `/compare` returns declarations, `/compare/measurements` returns sizes, advisories, and tarball summaries | Two handlers and two round trips, but each response is single-purpose, strictly typed, and independently cacheable. Requests are issued in parallel; the Effect caches share manifest lookups. | **Chosen** |
| One endpoint with `?tier=` | Fewer files, but a union-shaped response keyed by a query param, and the shared facts function used by the briefing becomes conditional. | Rejected |
| Streamed partial JSON (NDJSON or chunked) | Saves roughly one RTT versus two parallel same-origin requests, but needs a client stream state machine, forfeits HTTP cacheability, and makes tests materially harder. | Rejected |

## 4. Contracts

### 4.1 `GET /api/package/{encodedPackageName}/compare?from={versionOrTag}&to={versionOrTag}`

Returns declarations only. Same validation, router params, and resolved-version authority as today.

```ts
type PackageDeclarationsResponse = {
  packageName: string;
  from: ParsedPackageVersion; // resolved version; tags and ranges are resolved server-side
  to: ParsedPackageVersion;
  comparison: DeclarationComparison;
};

type DeclarationComparison = Pick<
  PackageComparison,
  'dependencies' | 'peers' | 'node' | 'moduleFormat' | 'exports' | 'types' | 'licenses' | 'installScripts'
>;
```

Removed from this route, with reasons:

- `releaseNotes` — display data for no consumer; it costs a GitHub round trip (~0.37 s measured, plus a changelog fetch) inside the page's critical path. The briefing route still collects it server-side for the prompt.
- `from`/`to` evidence attachments (`vulnerabilities`, `bundleSize`, `tarball.files[]`, `tarball.changelogs[].body`) — moved to §4.2.

### 4.2 `GET /api/package/{encodedPackageName}/compare/measurements?from={version}&to={version}`

Returns measurements for a resolved pair. Callers pass the resolved versions from §4.1 (the same rule the briefing route already follows), so tag and range inputs resolve identically and manifest lookups are cache hits.

```ts
type PackageMeasurementsResponse = {
  packageName: string;
  from: string;
  to: string;
  sizes: PackageComparison['sizes'];
  advisories: PackageComparison['advisories'];
  tarball: { from: TarballSummary; to: TarballSummary };
};

type TarballSummary = {
  status: PackageTarball['status'];
  reasons: readonly string[];
  url: string;
  fileCount: number;
  changelogCount: number;
};
```

`sizes.unpacked` keeps its `sources: 'registry' | 'tarball'` reporting and stays in the measurements tier even when the registry supplies `dist.unpackedSize`, so the “Size & provenance” group renders as one unit rather than splitting mid-group.

### 4.3 Unchanged behavior

- `GET /api/package/{encodedPackageName}/compare/briefing` keeps its request, response, cache identity, model configuration, and 75-second deadline. It continues to collect complete facts (`getComparisonFacts`) server-side for the evidence packet.
- The server keeps the full `PackageTarball` type internally; only the wire shape shrinks. Briefing evidence packing is untouched.
- Process-local Effect caches, their keys, lifetimes, and the no-retry policy are unchanged. Both new routes read through the same caches, so a page load still collects each version's manifest once.
- No compression middleware, CDN configuration, or HTTP cache headers are added in this work. Trimming makes compression a secondary concern (28 KB raw for the measured worst case).

## 5. Rendering

| Tier | Source | When it renders |
| --- | --- | --- |
| Declarations: “Dependencies & runtime” and “Package surface” groups, dependencies tile | `/compare` | Awaited during SSR and present in the first HTML; client-side navigation renders it as soon as the query resolves |
| Measurements: “Size & provenance” group (unpacked, minified, gzip, advisories, tarball), gzip and security tiles | `/compare/measurements` | Client-only, enabled once declarations resolve the version pair |
| AI notes and sources | `/compare/briefing` | Unchanged, already progressive |

Rules:

- Tier-2 rows exist from the first paint with an explicit pending value (`Measuring…`); the gzip and security tiles use the same pending convention as the current security tile (`Checking…`).
- Aggregate text that would be wrong while pending — the “_N_ of _M_ categories changed” counter — is not shown as final before tier 2 resolves; it shows a pending label instead.
- Row and tile structure is identical pending and resolved, so nothing shifts when measurements land.
- Tier-2 failure degrades per row and per tile to the existing unavailable wording; the page never blocks on tier 2, and the declarations remain usable.
- Tier-1 failure keeps the current error block and the “try again from package search” link.

## 6. Streaming SSR

- Enable `experimental.ssrStreaming: true` in `nuxt.config.ts` (verified available in the pinned Nuxt 4.5.2; `@nuxt/nitro-server` renders with `renderToWebStream`).
- The page awaits a tier-1 prefetch during SSR only, writing into the existing `@tanstack/vue-query` client so the plugin's `dehydrate` on `app:rendered` and client `hydrate` carry declarations to the client without a second request. The prefetch respects the existing 60-second `staleTime`, so hydration does not trigger an immediate refetch.
- Client-side navigation (from the home page) keeps the existing vue-query behavior: the query fetches on mount, and the tier-2 query waits for resolved versions.
- Bots: Nuxt disables streaming for crawler user agents, so crawlers receive the fully rendered declarations page. Measurements remain client-only for every user agent.

## 7. Failure, caching, and latency expectations

| Failure | Result |
| --- | --- |
| Manifest lookup fails for either version | Tier 1 fails; the page shows the existing error block. Tier 2 is not requested. |
| Tarball, OSV, or Bundlephobia fails | Its own rows and tiles show unavailable or partial states; declarations are unaffected. |
| GitHub release notes fail | No effect on the page: release notes are consumed only by the briefing route, which already reports `partial`/`unavailable` coverage. |
| Briefing provider fails or times out | Unchanged: `briefing.status: 'unavailable'` with the existing sanitized reasons. |
| SSR prefetch fails | The dehydrated state carries the error, and the client renders the existing error block. |

Expected effect for the measured worst case (lodash, Fast 3G, cold process): declarations and the first eight rows render well under a second instead of 4.29 s; the tier-1 payload drops from 293 KB to roughly 28 KB raw; measurements arrive later and can no longer blank the page while Bundlephobia builds or rate-limits.

## 8. Verification

Unit tests, all with external HTTP stubbed (existing convention — no network in tests):

- `server/api/package/[packageName]/compare/index.get.unit.ts`: rewritten for the declarations shape; asserts the payload contains no `releaseNotes`, no tarball file inventory, and no changelog bodies, and that no GitHub request is made on this route.
- `server/api/package/[packageName]/compare/measurements.get.unit.ts`: new; sizes, advisories, tarball summaries, resolved versions for tag inputs, and per-provider failure isolation.
- `server/utils/packageComparison.unit.ts` and `packageVulnerabilities.unit.ts`: keep their existing coverage; adjust only where the comparison split changes the exported seam.
- `app/pages/[packageName]/comparisonView.unit.ts`: declaration rows, measurement rows, pending labels, and unavailable wording.
- `app/composables/packageComparisonQueryOptions.unit.ts`: updated key/shape expectations; new measurements query options test.

Acceptance proof, run against the production build:

- Same browser harness as the measurement above: at Fast 3G, cold process, the comparison table (declaration rows) is visible in under 1.2 s, no full-page loading sentence appears, and measurement rows fill in without interaction.
- Tier-1 response size for the lodash pair is ≤ 40 KB raw, verified on the wire.
- Repeat view with a warm process shows no pending state for declarations.

Documentation: update the README response-shape sections (comparison response, tarball evidence, release notes placement) in the same cutover, since the route contract changes.

## 9. Out of scope

- Payload compression middleware or proxy/CDN configuration.
- Prefetching a comparison from the home page on selection or hover.
- Skeleton shimmer animation or other visual polish beyond the pending labels.
- File-level tarball diff UI (which would need a dedicated endpoint; the per-file inventory leaves the wire here).
- Crawler-specific blocking renders for measurements, sitemap or metadata work.
- Changing the briefing model or its deadline.

## 10. Risks

- **Breaking contract.** `/compare` loses `releaseNotes` and the per-file inventory, and gains a sibling route. The only consumer is this repository's page (verified), and README plus tests move in the same cutover; any external consumer would break.
- **Two requests instead of one** add a small amount of client bookkeeping and one extra connection on HTTP/1.1; on HTTP/2 this is negligible, and both are same-origin.
- **SSR prefetch cost.** Every page view now collects manifests on the server, including for crawlers. Manifests are the cheapest provider in the set and are cached per exact version for five minutes; measurement collection stays client-driven.
- **Expectation gap.** Bundlephobia still gates its two rows and the gzip tile for up to its 30-second deadline; the improvement is that this wait no longer blanks the page.
