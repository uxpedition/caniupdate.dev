# RFC 0002: Server module ownership

**Status:** ACCEPTED — structure and scope approved in conversation; implementation not yet started

**Date:** 2026-10-04

Acceptance records the agreed direction, not shipment. The full cutover remains subject to review of this written design and a separate implementation plan.

## Summary

Eliminate `server/utils` and organize server-side code by ownership. Use purpose-specific `server/httpDependencies/<provider>/` modules for external HTTP integrations, and group comparison work—including evidence collection and briefing—under `server/comparison/`. Give every Nuxt API endpoint its own directory with an `index.<method>.ts` handler. Keep endpoint-specific implementation in a nested `_internals/` directory, excluded from Nitro's route scanner; put code shared by sibling endpoints in their nearest common `_internals/` directory.

Move every current `server/utils` implementation and its tests, update all route, Worker, test, and documentation references, and remove the old directory. Split existing files only where needed to establish the agreed ownership: endpoint decoding and Cloudflare evidence calls move to the API; provider-specific HTTP belongs with the provider adapter; comparison policy and evidence orchestration belong to the comparison domain. Preserve runtime behavior and external contracts.

## Source baseline

This section records the source state when the RFC was accepted:

- [`server/utils/`](../../../server/utils/) contains registry, GitHub, OSV, and Bundlephobia integrations; comparison and evidence collection; briefing generation and storage; tarball inspection; a Cloudflare evidence client; and route helpers. Their ownership is not legible from the common directory.
- Nuxt handlers live directly in `server/api/` directories that mix endpoint handlers with shared code currently imported from `server/utils/`. For example, comparison selectors and collection operations are both imported from `packageComparisonFacts.ts` by the declarations and briefing handlers.
- The briefing and evidence Workers import application comparison and briefing implementations from `server/utils/`. Moving those modules must update Worker imports; it does not move Worker runtime code or make those modules Nuxt-specific.
- `nuxt.config.ts` currently excludes `**/*.unit.ts` from Nitro discovery, while Vitest includes `**/*.unit.ts` beneath `server/`. Nitro maps every other TypeScript file beneath its scanned API directory to a route; a helper filename or leading underscore alone does not suppress route discovery.
- An isolated probe using the repository's installed Nitro scanner confirmed that `briefing/index.post.ts` maps to the existing POST `/api/package/:packageName/compare/briefing`, and that `_internals/` files also map to routes unless `**/_internals/**` is ignored. The same probe confirmed that adding the ignore pattern leaves the handler route intact.
- Current architecture and product documents link directly to `server/utils` implementation paths. Those links are living documentation and must be updated to the new locations. This RFC retains its source-baseline links as historical evidence.

## Goals

1. Make ownership discoverable from module placement: Nuxt API handling, external HTTP integrations, and comparison-domain behavior each have clear homes.
2. Establish a stable endpoint directory pattern before endpoints grow: `index.<method>.ts`, adjacent endpoint tests, and narrowly scoped `_internals/`.
3. Eliminate the `server/utils` dumping ground without introducing another catch-all directory or compatibility layer.
4. Keep backend modules reusable by both the Nuxt Worker and Cloudflare Workers without coupling provider adapters to Nuxt or moving Worker runtime code.
5. Preserve all existing observable behavior and data contracts through the refactor.

## Non-goals

- Changing endpoint URLs, methods, query/body formats, status codes, validation rules, or public response schemas.
- Changing the comparison product behavior, evidence coverage semantics, provider budgets/timeouts, cache keys or lifetimes, evidence hashes, briefing prompts, job state transitions, storage formats, or D1/DO behavior.
- Reworking Worker entrypoints, Durable Object ownership, bindings, or deployment configuration beyond import updates required by relocated modules.
- Restructuring browser pages or composables, moving shared contracts from `shared/`, adding dependencies, or introducing a generic HTTP client abstraction.
- Creating `server/ssr/` absent code whose ownership is specifically SSR rather than merely executed during SSR.
- Keeping aliases, forwarding exports, or a compatibility `server/utils` path after migration.

## Proposed module layout

### API route directories

Every existing Nuxt API route gets its own directory, including routes that currently have only one handler:

```text
server/api/
├── health/
│   └── index.get.ts
├── search/
│   ├── index.get.ts
│   └── index.get.unit.ts
└── package/[packageName]/
    ├── index.get.ts
    └── compare/
        ├── index.get.ts
        ├── index.get.unit.ts
        ├── _internals/
        │   ├── request.ts
        │   └── evidenceClient.ts
        ├── measurements/
        │   ├── index.get.ts
        │   └── index.get.unit.ts
        └── briefing/
            ├── index.post.ts
            ├── index.post.unit.ts
            └── _internals/
                ├── submission.ts
                └── socketUrl.ts
```

The exact internal file split can follow current function cohesion, but ownership is fixed:

- `compare/_internals/request.ts` owns comparison route parameter/query decoding shared by declarations, measurements, and briefing. This validation is an API concern, not evidence collector policy.
- `compare/_internals/evidenceClient.ts` owns the Nuxt-to-private-`PackageEvidence` binding adapter and its sanitized protocol/transport failures, shared by the measurements and briefing endpoints.
- `briefing/_internals/` owns briefing-only response normalization, disposable RPC result handling, sanitized submission logging, response construction, and socket URL rewriting. Keep a small helper in `index.post.ts` when extracting it would add indirection without clarifying ownership.
- Search and package metadata handlers keep their endpoint-specific query/response mapping at the handler or their own `_internals/` if it grows. Their shared npm registry HTTP request belongs to the npm adapter.

The route scan configuration must exclude both `**/*.unit.ts` and `**/_internals/**`. Tests remain discoverable by Vitest. No other naming convention is assumed to hide handlers from Nitro.

### Provider-specific HTTP integrations

```text
server/httpDependencies/
├── npm/
│   ├── registry.ts
│   ├── errors.ts
│   ├── tarball.ts
│   └── tarballStreaming.ts
├── github/
│   └── client.ts
├── osv/
│   └── client.ts
└── bundlephobia/
    └── client.ts
```

These modules own fixed-origin requests, provider authentication/headers, provider response decoding, and provider-specific transport limits. The npm tarball modules remain under `npm/`: their verified archive download and streaming inspection are specialized package-registry integration used by evidence collection, not a generic archive framework. `RegistryRequestError`, currently declared with evidence errors but also used by search and package metadata, moves to the npm integration so callers share one provider-specific failure type.

Provider adapters do not import comparison logic, H3 request/event types, route modules, or Worker entrypoints. Do not add a generic transport abstraction solely because these modules share a parent folder.

### Comparison domain

```text
server/comparison/
├── collect.ts
├── declarations/
│   └── compare.ts
├── measurements/
│   ├── compare.ts
│   ├── bundleSize.ts
│   └── vulnerabilities.ts
├── evidence/
│   ├── errors.ts
│   ├── services.ts
│   └── releaseNotes.ts
└── briefing/
    ├── generation.ts
    ├── provider.ts
    ├── prompt.ts
    ├── store.ts
    └── evidence/
        ├── build.ts
        ├── changelog.ts
        └── packing.ts
```

- `collect.ts` owns manifest lookup/sharing, evidence cache policy, collection fan-out, and construction of declaration, measurement, and complete-briefing facts. Move the route query and router parameter schemas out of this module.
- `declarations/compare.ts` owns declaration-difference rules currently in `packageComparison.ts`.
- `measurements/compare.ts` owns measurement, size, and advisory comparison rules currently in `packageComparison.ts`. The extraction must retain their result shape, ordering, and incomplete-coverage semantics.
- `measurements/bundleSize.ts` and `measurements/vulnerabilities.ts` convert provider data into domain measurement evidence; HTTP requests and provider wire decoding remain in their provider adapters.
- `evidence/errors.ts` owns cache, evidence collection/storage/corruption, archive admission, and response admission errors. `evidence/services.ts` owns the explicit cache and admission interfaces shared with `workers/evidence/`.
- `evidence/releaseNotes.ts` owns package-specific selection and interpretation of GitHub releases/changelogs. GitHub HTTP access remains in `httpDependencies/github/`.
- `briefing/` owns evidence identity, AI generation/configuration, prompt rules, validated result persistence, and bounded packet construction. The D1 store remains reusable by `workers/briefing/`; it is application behavior, not Nuxt route code.
- `briefing/evidence/` groups packet assembly, changelog extraction, and bounded evidence packing, which currently form one cohesive briefing evidence pipeline.

The exact extraction of a mixed source file follows these ownership rules: move existing behavior without changing it; split only functions with different owners; update every caller and test in the same cutover. Preserve existing public function signatures where a consumer can reasonably depend on them, changing only internal import paths and private function grouping.

### Dependency direction

```text
Nuxt route handlers ───────┬────> comparison domain ─────> provider HTTP integrations
                            └────> API-local private binding adapters
Workers ─────────────────────────> comparison domain
search / package metadata ───────> npm HTTP integration
```

Provider adapters depend on shared schemas and runtime HTTP libraries, not the comparison domain. The comparison domain may use provider adapters and shared contracts, but has no dependency on Nuxt/H3. API-local `_internals/` may depend on Cloudflare bindings and protocol types; they are not imported by the comparison collector. Worker lifecycle and storage adapters remain in `workers/`, and Worker-to-domain imports are updated to the new comparison paths.

## Full relocation map

All current implementation and unit-test files in `server/utils/` move as follows; `.unit.ts` files travel with the module they exercise and retain behavior coverage:

| Current module(s) | New ownership |
|---|---|
| `npmRegistry.ts`, `npmRegistry.unit.ts` | `server/httpDependencies/npm/registry.ts`, adjacent unit test |
| `github.ts`, `github.unit.ts` | `server/httpDependencies/github/client.ts`, adjacent unit test |
| `osv.ts`, `osv.unit.ts` | `server/httpDependencies/osv/client.ts`, adjacent unit test |
| `bundlephobia.ts` | `server/httpDependencies/bundlephobia/client.ts` |
| `packageTarball.ts`, `packageTarball.unit.ts`, `packageTarballStreaming.ts`, `packageTarballStreaming.unit.ts` | `server/httpDependencies/npm/tarball.ts` and `tarballStreaming.ts`, with adjacent tests |
| `packageComparison.ts`, `packageComparison.unit.ts` | split into `comparison/declarations/compare.ts` and `comparison/measurements/compare.ts`, with tests alongside the matching rules |
| `packageComparisonFacts.ts`, `packageComparisonFacts.unit.ts` | `server/comparison/collect.ts` and its unit test; remove API schemas into `compare/_internals/request.ts` |
| `packageEvidenceErrors.ts` | `comparison/evidence/errors.ts`, except `RegistryRequestError` moves to `httpDependencies/npm/errors.ts` |
| `packageBundleSize.ts`, `packageBundleSize.unit.ts` | `comparison/measurements/bundleSize.ts` and adjacent unit test |
| `packageVulnerabilities.ts`, `packageVulnerabilities.unit.ts` | `comparison/measurements/vulnerabilities.ts` and adjacent unit test |
| `packageReleaseNotes.ts`, `packageReleaseNotes.unit.ts` | `comparison/evidence/releaseNotes.ts` and adjacent unit test |
| `packageEvidenceClient.ts`, `packageEvidenceClient.unit.ts` | `server/api/package/[packageName]/compare/_internals/evidenceClient.ts` and its unit test |
| `packageBriefing.ts`, `packageBriefingGeneration.unit.ts` | `comparison/briefing/generation.ts` and adjacent unit test |
| `packageBriefingProvider.ts` | `comparison/briefing/provider.ts` |
| `packageBriefingPrompt.ts` | `comparison/briefing/prompt.ts` |
| `packageBriefingStore.ts`, `packageBriefingStore.unit.ts` | `comparison/briefing/store.ts` and adjacent unit test |
| `packageBriefingEvidence.ts`, `packageBriefingEvidence.unit.ts` | `comparison/briefing/evidence/build.ts` and adjacent unit test |
| `packageBriefingEvidenceChangelog.ts` | `comparison/briefing/evidence/changelog.ts` |
| `packageBriefingEvidencePacking.ts` | `comparison/briefing/evidence/packing.ts` |
| `briefingSocketUrl.ts`, `briefingSocketUrl.unit.ts` | `server/api/package/[packageName]/compare/briefing/_internals/socketUrl.ts` and its unit test |

Additionally, the declarations and measurements endpoint tests move beside their respective new handlers. Search, package metadata, and health handler tests (if present at cutover) move beside their endpoint directories. Test contents should change only where imports/setup require it; retain consumer-visible behavior assertions.

## Compatibility and preservation requirements

- The six routes retain their current method and public path: health, search, package metadata, declarations comparison, measurement comparison, and briefing submission.
- Request decoding, exact-version resolution, response schemas, sanitized failure messages, and status codes do not change.
- Cache identities/revisions/TTL, evidence admission limits, provider deadlines, source packing order, briefing hash input, generated prompt, and citation rules do not change.
- D1 first-writer-wins, DO SQLite transactions, response/storage validation, queue/job state and recovery, and Worker bindings remain unchanged.
- All Worker, API, test, script, and living documentation callsites migrate. No code imports from `server/utils`; no source directory, alias, barrel, or compatibility re-export remains there.
- Existing unit tests continue to run at their relocated paths. No new test is needed solely to assert a file move; verification instead checks module resolution, Nitro's route inventory, existing behavior suites, type checks, builds, and runtime smoke flows.

## Alternatives considered

### Keep `server/utils` and improve names

Renaming helper files would retain the central dumping ground and leave callers to learn an informal naming convention. Rejected because directory ownership is the main goal.

### One shared backend folder by technical layer

Keeping all collectors, stores, request decoders, and provider clients in broad `clients`, `services`, or `common` folders would hide whether a module belongs to a provider, endpoint, or comparison rule. Rejected in favor of the three concrete owners above.

### Put every implementation next to an endpoint

This would duplicate or entangle code shared by the declarations, measurements, and briefing endpoints, and would prevent Workers from reusing comparison behavior without importing route code. Endpoint `_internals/` is reserved for Nuxt handling and route-specific adapters; reusable comparison behavior remains domain-owned.

### Keep one mixed comparator/collector module

Keeping `packageComparison.ts` intact would preserve a file that mixes declaration and measurement rules. The accepted structure separates these rules because their inputs, output contracts, and domain responsibilities differ; tests move with each rule set. This is a structural split only, not a policy change.

## Rollout and acceptance

1. Keep the current `server/utils` implementation and test coverage intact until each destination is ready; perform the cutover in coherent, reviewable batches.
2. Establish endpoint directories and Nitro exclusions, then confirm the generated route inventory is exactly the six existing routes.
3. Relocate provider integrations, split comparison modules, and move briefing/evidence implementations. Update every API and Worker import and colocate route-specific implementations and tests.
4. Search the repository for legacy code imports/aliases and old documentation links. Update current overview, evidence, briefing, product, context, and any relevant decision-record citations; retain references inside this RFC only as explicitly historical baseline links.
5. Run the full existing test suite, type checks for Nuxt and both Workers, lint check, and production build. Exercise the running application through search, package metadata, declarations, measurements, and briefing (including the socket completion path) and observe the unchanged public behavior.

The cutover is complete only when `server/utils` is absent, Nitro discovers exactly the six existing API routes, no live source/docs reference points to the former modules, all existing checks pass, and runtime smoke flows work. Report any check not actually exercised; a compile alone is not completion evidence.

## References

- [Documentation organization](../../CONTEXT.md) and current [system overview](../overview.md), [evidence architecture](../evidence.md), and [briefing architecture](../briefing.md).
- Current API routes under [`server/api/`](../../../server/api/) and current implementation under [`server/utils/`](../../../server/utils/) (source baseline at acceptance time).
- [Nuxt Nitro configuration](../../../nuxt.config.ts), [Vitest configuration](../../../vitest.config.ts), [`workers/evidence/`](../../../workers/evidence/), and [`workers/briefing/`](../../../workers/briefing/).
