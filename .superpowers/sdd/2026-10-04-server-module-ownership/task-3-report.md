# Task 3 report — comparison policy, collection, and evidence ownership

## Status

Completed from base `f8040061689c3c63960d28b5cf9d6597280fea08`.

## Implementation

- Split comparison policy into `server/comparison/declarations/compare.ts` and `server/comparison/measurements/compare.ts`. Declaration ordering, deterministic dependency/advisory sorting, before/after values, partial coverage handling, and size rules remain behavior-tested. Removed the dead `comparePackages` forwarding export.
- Updated the briefing evidence fixture to locally assemble comparison facts from `compareDeclarations` and `compareMeasurements`; retained its behavior assertions and deleted only the forwarding-equality assertion.
- Moved collection, request-local manifest sharing, cache policy and identity, provider fan-out, compact measurement assembly, and private full-fact assembly into `server/comparison/collect.ts`.
- Moved route parameter/query schemas and decoders to `server/api/package/[packageName]/compare/_internals/request.ts`; all three compare route handlers consume it without changing request limits or decoding behavior.
- Moved Bundlephobia and OSV mapping into `server/comparison/measurements/{bundleSize,vulnerabilities}.ts`; moved release/tag/changelog evidence into `server/comparison/evidence/releaseNotes.ts`.
- Moved evidence cache/admission interfaces to `server/comparison/evidence/services.ts`; moved evidence failures to `server/comparison/evidence/errors.ts`. The failure union imports the one `RegistryRequestError` definition from `server/httpDependencies/npm/errors.ts`.
- Migrated the evidence Worker admission, storage, and collector callers to the new shared comparison interfaces/errors. Public measurement envelopes and private complete briefing packets remain distinct.

## Verification

### Prescribed baseline

```bash
nub exec -- vitest run server/utils/packageComparison.unit.ts server/utils/packageComparisonFacts.unit.ts server/utils/packageBundleSize.unit.ts server/utils/packageVulnerabilities.unit.ts server/utils/packageReleaseNotes.unit.ts workers/evidence/store.unit.ts
```

```text
Test Files  6 passed (6)
Tests  47 passed (47)
```

### TDD move checks

Changed test imports before each module move. The new comparison, collection, Bundlephobia, OSV, and release-note test paths each initially failed only because their destination module did not yet exist. After moving and splitting their implementations:

```bash
nub exec -- vitest run server/comparison/declarations/compare.unit.ts server/comparison/measurements/compare.unit.ts server/comparison/measurements/bundleSize.unit.ts server/comparison/measurements/vulnerabilities.unit.ts server/comparison/evidence/releaseNotes.unit.ts server/comparison/collect.unit.ts server/api/package/[packageName]/compare/index.get.unit.ts server/api/package/[packageName]/compare/measurements/index.get.unit.ts server/api/package/[packageName]/compare/briefing/index.post.unit.ts workers/evidence/store.unit.ts workers/evidence/admission.unit.ts server/utils/packageBriefingEvidence.unit.ts
```

```text
Test Files  12 passed (12)
Tests  94 passed (94)
```

### Prescribed focused suite, post-format

```bash
nub exec -- vitest run server/comparison server/api/package workers/evidence
```

```text
Test Files  14 passed (14)
Tests  105 passed (105)
```

### Type checking

```bash
nub run type-check
```

```text
nuxt typecheck && tsc --project workers/evidence/tsconfig.json && tsc --project workers/briefing/tsconfig.json
Exit: 0
```

### Runtime smoke

Started the local frontend and private Workers with isolated state and ports. Then called:

```bash
curl --fail --silent --show-error 'http://127.0.0.1:25174/api/package/minimist/compare?from=0.0.8&to=1.2.8'
```

The public declaration route returned HTTP 200 with resolved versions `0.0.8` and `1.2.8`, the compact declarations, and the unchanged declaration comparison object. The smoke service was stopped afterward.

## Self-review

- `git diff --check` produced no whitespace errors before staging.
- Obsolete comparison utility paths have no remaining imports. No compatibility aliases remain.
- API routes own only request decoding; collection owns evidence policy and result assembly; provider adapters remain independent of comparison policy, H3, and Workers.
- `getComparisonFacts` continues to emit private complete tarball evidence, while `getComparisonMeasurements` converts tarballs to compact summaries.
- The pre-existing formatting-only edit in `docs/engineering/rfcs/0002-server-module-ownership.md` is excluded from staging.

## Concern

`xd://lsp` reported `No language server found for this action` for the required `comparePackages` reference lookup, so LSP `rename_file` was unavailable for these moves. A repository-wide import search found no production `comparePackages` caller; only comparator tests and the briefing fixture used it. Moves were performed with `git mv`, imports were migrated explicitly, and focused suites plus the runtime smoke passed.
