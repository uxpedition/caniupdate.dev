# Comparison compute and evidence optimization

## Scope and decisions

Implement shared persisted evidence and Durable Object-backed streaming cache misses on `main`. The user approved this work after the isolated DO/streaming feasibility experiment. Preserve existing comparison response shapes, progressive declarations/measurements/briefing, archive security checks, per-file hashes, and the D1 briefing-result store. Do not deploy remotely or change billing as part of local implementation.

Use a separate private SQLite-backed Worker exporting one `PackageEvidence` Durable Object class, routed deterministically by npm package name. One package object owns its version/archive evidence so comparisons involving the same archive share it without transferring full inventories between objects. The public Nuxt Worker requests compact measurements or a bounded briefing evidence packet; archive inventories and packet construction stay in the backend. AI inference and its existing D1 result cache stay unchanged in the Nuxt Worker.

### Cache policy

- Archive cache identity includes an inspector revision and the expected integrity policy (present SRI, otherwise legacy shasum). Key inputs must preserve strongest-algorithm validation and never turn malformed SRI into a SHA-1 fallback. An unchanged verified archive can be reused across version pairs. Validate the current npm tarball URL even on cache hits; attach the current URL rather than an old cached URL. Only available/partial verified inspections persist; download errors, invalid integrity, timeouts, and other unavailable inspections never persist.
- Validated npm manifests, successful OSV evidence, successful Bundlephobia evidence, and successful GitHub evidence have a five-minute freshness window. Mutable evidence is not permanent. Failed/unavailable provider results are not persisted. Partial provider results containing transient failures are not persisted either.
- Cache keys include a schema/collector revision and every input affecting that provider result. GitHub evidence must distinguish the relevant resolved manifest/repository/ref inputs. No API credentials are keys or stored evidence.
- An object coalesces simultaneous identical cache misses. Share computation, not a consumed Response stream. Do not retain completed evidence indefinitely in JavaScript memory.
- Bound archive inspection concurrency across each backend isolate, without waiting on another object's I/O promise. Capacity rejection is explicit and temporary, not a cached archive failure. Keep byte/entry/text bounds and streaming backpressure.
- SQLite records must handle valid inspection payloads exceeding its 2 MB row/value limit without truncation or Unicode corruption. Writes are atomic; expired mutable records are reclaimed. A storage/binding failure must not silently fall back to expensive work in the frontend.
- No new application dependencies, patched Effect runtime, retries, paid provider calls, or permanent caching of mutable evidence.

## Interface and ownership contracts

Internal HTTP interface over the private `PACKAGE_EVIDENCE` Durable Object namespace:

```ts
type EvidenceRequest = { packageName: string; from: string; to: string };
// Object name: packageName; POST JSON to either path:
// /measurements -> existing PackageMeasurementsResponse
// /briefing-evidence -> existing BriefingEvidence (bounded packet, not BriefingInput)
```

The backend validates request names/versions. The frontend must require its request's Cloudflare namespace binding, never use process-global bindings or fall back to local archive work. Backend failures return a sanitized non-success status; the frontend preserves a meaningful unavailable service response. Backend env may contain `GITHUB_TOKEN`; AI credentials remain frontend-only.

1. **Streaming agent:** `server/utils/packageTarball.ts` and its unit tests only. Preserve `getPackageTarball(manifest): Effect<PackageTarball>`. Port the verified 64 KiB streaming approach from the isolated experiment, retaining all validators and hashes, removing obsolete buffered decompression. Regression focus: gzip/trailer/32 MiB boundaries, failures and cancellation; no test-only exports in production.
2. **Evidence backend agent:** `workers/evidence/` implementation files, evidence store/coordinator modules, `server/utils/packageComparisonFacts.ts` and its unit tests. Add persisted provider reuse and same-object miss coalescing; reuse existing collectors, not duplicate provider logic. Separate compact response/packet generation from stored full inventories. Parent owns worker configuration. Coordinate with the route agent before any shared-file change.
3. **API integration agent:** measurement and briefing routes and their tests, `server/utils/packageBriefing.ts` and its unit tests, `shared/cloudflare.d.ts`, and a focused namespace client module. Change briefing generation to consume `BriefingEvidence`; migrate every caller/test. Retain D1 first-writer-wins behavior and evidence hashing. Declarations remain independent and do not wait for the backend.
4. **Main:** configuration, scripts, existing docs, integration ownership, workerd/browser smoke, central validation, and cross-slice review. All agents skip formatters, linters, builds, and test execution during concurrent edits; Main runs validation after integration. No commits, pushes, deployments, or unrelated file edits.

## Implementation and acceptance

- [x] Replace full-buffer decompression with bounded streaming inspection.
- [x] Persist verified per-archive inspections; invalidate by integrity and inspector revision.
- [x] Persist successful mutable provider evidence with five-minute expiry; share measurements/briefing inputs.
- [x] Coalesce concurrent misses and enforce bounded archive admission.
- [x] Handle SQLite row limits, atomic persistence, restart reuse, expiry, and storage failures.
- [x] Route measurements and bounded briefing evidence through the private backend.
- [x] Wire local Nuxt development, built workerd preview, binding types, backend build, and explicit deployment order.
- [x] Verify real runtime cold/warm/restart behavior; integrity changes; expiry; failures recovering; concurrent reuse; large stored Unicode payloads; unchanged comparison outputs.
- [x] Verify progressive browser behavior and existing D1 briefing-result semantics without paid AI calls.
- [x] Run central type checks, relevant tests, lint/format checks, build, and final review.

## Deferred optimization backlog

- [x] Prerender the request-independent homepage, preserving hydration, search and API behavior.
- [ ] Reduce remaining comparison-page SSR work and verify its CPU separately. Archive offload alone does not establish Free-tier suitability for the Nuxt Worker.
- [ ] Retire unused per-file SHA-256 fields/computation deliberately across types/tests/docs. Keep whole-archive integrity verification. Prior isolated probe showed about 19% lower local archive wall time.
- [ ] Filter redundant Effect response-header trace attributes while retaining business headers, spans and propagation. Synthetic benefit measured; deployed end-to-end saving not yet proven.
- [ ] Measure the full deployed browser-to-briefing path after the selected architecture is integrated, including cache misses, warm hits, SSR CPU, concurrent memory pressure and Free-tier duration/request quotas.

Do not revisit native DecompressionStream, WebCrypto hashing, decoder reuse, or complex packet packing without new evidence: previous experiments showed no convincing benefit. AI generation coalescing/budgets remain separate from evidence coalescing.

## Package metadata profiling

Profiled the install-v1 packuments for `@types/node` (2,373 versions; 2.33 MB), `typescript` (3,834; 8.70 MB), and `lodash` (117; 69.6 KB) locally with Bun. Schema decoding medians were 1.9 ms, 2.9 ms, and 0.08 ms. The old metadata conversion medians were 3.86 ms, 9.24 ms, and 0.08 ms; conversion using a per-call parsed-version sort measured 0.57 ms, 1.69 ms, and 0.02 ms, with identical output in all three samples. The two large packuments therefore reduced conversion CPU by 85% and 82%; the small-package percentage is noise-sensitive.

Client-side computed projections were measured separately: on `typescript`, building the version lookup and select options took about 0.3 ms and 0.2 ms. Filtering options from a selected lower bound measured 2.865 ms before and 1.707 ms after reusing a parsed lower bound (40.4% lower), with identical options. This Vue-computed profile ran locally under Bun; it excludes browser rendering and does not represent deployed CPU.

`toPackageMetadata` now uses an in-place descending sort that parses each version once. It preserves prerelease precedence, stable ordering for compare-equal build metadata, and the existing numeric-locale fallback for non-semver strings. `compareSemver` also compares parsed core fields without allocating a tuple array on every comparison.

Verification: the local Nuxt `GET /api/package/typescript` smoke returned HTTP 200 with 3,834 versions and descending semver order. Chromium selected TypeScript `beta` (`6.0.0-beta`) as the lower bound; target options included the boundary release and showed no `5.0.0` match. The browser reported no errors. The full suite passed (180 tests across 24 files); type checks, formatting, and the production build passed. Lint exited with zero errors and the same five warnings in untouched files. No deployment was performed.

## Evidence and status

Investigation: `.data/cpu-investigation/2026-09-23/investigation-results.json`.
DO/streaming feasibility: `.data/cpu-investigation/2026-09-23/do-streams/results.json`.
The probe established CPU-budget separation and archive acceptance equivalence, not a completed production migration or guaranteed memory upper bound. Sampled memory excludes some native/runtime allocation.

Implementation is on `main`, uncommitted and not deployed. Three implementation agents owned streaming, backend persistence, and frontend integration; two reviewers covered the frontend/runtime and backend/security boundaries. Two additional agents handled streaming/client quality fixes after the lint gate. Main integrated and verified the actual runtimes. Final checks passed: 175 tests across 23 files, both type checks, formatting, build, and lint with zero errors / five pre-existing warnings. Worker ambient types are scoped so they do not replace Node's Buffer typing; persisted values are schema-checked without generic casts.

Functional workerd results: `.data/evidence-runtime-results.json` (ignored). Concurrent cold measurements/briefing made two archive, two manifest, one OSV, and two Bundlephobia calls. Warm requests and a fresh runtime added zero calls. Each large persisted inspection was 4,981,761 bytes in 112 chunks. A 24-request gated burst admitted sixteen coalesced callers and rejected eight with 503; a forced second-chunk SQL failure rolled back atomically and recovered. Expiry, integrity changes, temporary archive failures, unsafe URLs, strong-SRI precedence, cross-version integrity reuse, and corrupt-storage failure behavior were exercised.

Built-preview Chromium checks covered package search, scoped-package comparison navigation, progressive results, and direct minimist reload. Nuxt development connected to the separate backend and served populated comparison rows after a server hot reload. AI stayed disabled (`not-configured`); no paid generation or remote deployment was performed. Browser screenshots and the runtime JSON are local evidence, not a deployed CPU or memory guarantee.

The archive inspector still requires the existing `package/` root; tested `@types/minimist` archives remained unavailable without discarding other evidence. Per-isolate admission is two inspections, two distinct collection/response jobs, and sixteen pending HTTP requests. Immutable evidence has no eviction policy; account storage and duration/request quota verification remain rollout work.
