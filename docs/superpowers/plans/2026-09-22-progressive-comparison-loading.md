# Progressive Comparison Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the comparison page's declaration rows in the first paint and let sizes, advisories, and tarball evidence fill in afterwards, by trimming the facts payload and splitting the API into declarations and measurements tiers.

**Architecture:** `GET /compare` becomes manifest-only (declarations) and `GET /compare/measurements` serves sizes, advisories, and tarball summaries for a resolved pair. The briefing route is unchanged and keeps collecting complete facts server-side for its evidence packet. The page awaits a server-side prefetch of the declarations tier into the existing TanStack Query cache so the first HTML contains the table, and the measurements tier is a client-only query enabled once declarations resolve the version pair.

**Tech Stack:** Nuxt 4.5.2, Nitro/H3 v2, Vue 3.5, TanStack Vue Query 5, Effect 4 RC, Vitest 5, npm registry / OSV / Bundlephobia / GitHub as upstream evidence providers.

**Spec:** `docs/superpowers/specs/2026-09-22-progressive-comparison-loading-design.md`

## Global Constraints

- No new runtime dependencies. No compression middleware, CDN configuration, or HTTP cache headers (spec §9).
- `/compare` must not return `releaseNotes`, per-file tarball inventory (`files`), or changelog bodies (`changelogs[].body`). It must not issue GitHub requests (spec §4.1).
- Release notes are maintainer evidence for AI inference only; they surface to users only as briefing `maintainer` sources (spec §2).
- Pending measurement rows are labeled `Measuring…`; never a fabricated zero or a blank cell. Pending and resolved rows share identical labels, anchors, and order (spec §5).
- Tier-2 failure degrades per row and per tile; it never blocks declarations (spec §5).
- Measurements and briefing are client-only tiers: their queries must never enable during SSR, or every page view pays provider and model calls server-side (spec §1 cause 4, §5).
- Unit tests stub all external HTTP; no test may reach the network. Tests live beside their module as `*.unit.ts` and are excluded from the Nuxt build by `ignore: ['**/*.unit.ts']`.
- Verification commands: single file `nub exec -- vitest run <path>`, full suite `nub run test`, type check `nub run type-check`.
- Commits use conventional messages (commitlint runs on commit-msg). The pre-commit hook runs `oxfmt`, `oxlint`, and `nuxt typecheck`; do not run them manually.
- Task 2 is a single contract cutover: the app is coherent again only at the end of that task. Do not commit a partial cutover.

---

## File Structure

**Created**

- `server/api/package/[packageName]/compare/measurements.get.ts` — measurements route handler.
- `server/api/package/[packageName]/compare/measurements.get.unit.ts` — evidence tests retargeted from the comparison route.
- `server/utils/packageComparisonFacts.unit.ts` — release-note/GitHub scheduling tests against `getComparisonFacts`.
- `app/composables/packageMeasurementsQueryOptions.ts` — measurements query options and key.
- `app/composables/packageMeasurementsQueryOptions.unit.ts` — key/enablement test.
- `app/pages/[packageName]/comparisonSummary.unit.ts` — pending and resolved row presentation.

**Modified**

- `shared/comparison.defs.ts` — declaration/measurement halves, tarball summary, wire response types.
- `server/utils/packageComparison.ts` — declaration/measurement comparison split.
- `server/utils/packageComparisonFacts.ts` — declarations, measurements, and facts composition.
- `server/api/package/[packageName]/compare/index.get.ts` — declarations only.
- `server/api/package/[packageName]/compare/index.get.unit.ts` — declaration-focused tests.
- `server/utils/packageComparison.unit.ts` — split coverage.
- `app/composables/packageComparisonQueryOptions.ts` — response type moves to shared defs.
- `app/composables/packageComparisonQueryOptions.unit.ts` — unchanged expectations, import path only if needed.
- `app/composables/useComparisonPage.ts` — three tiers, server prefetch.
- `app/pages/[packageName]/comparisonView.ts` — tier-aware row builders.
- `app/pages/[packageName]/comparisonView.unit.ts` — tier-aware fixtures and pending coverage.
- `app/pages/[packageName]/comparisonSummary.ts` — tier-aware summaries with pending values.
- `app/pages/[packageName]/[versionPair].vue` — tiers, pending tiles, counter label.
- `nuxt.config.ts` — `experimental.ssrStreaming`.
- `README.md` — response shapes, tiered loading, cache note.

**Deleted**

- `app/composables/usePackageComparisonQuery.ts`, `app/composables/usePackageBriefingQuery.ts` — thin wrappers that can no longer own query creation, because the declarations options object is needed for the server prefetch in the same place.

---

### Task 1: Split the comparison computation and wire types

**Files:**
- Modify: `shared/comparison.defs.ts`
- Modify: `server/utils/packageComparison.ts`
- Test: `server/utils/packageComparison.unit.ts`

**Interfaces:**
- Consumes: existing `ParsedPackageVersion` (`shared/package.defs.ts`), `PackageTarball` (`shared/tarball.defs.ts`).
- Produces: `DeclarationComparison`, `MeasurementComparison`, `TarballSummary`, `DeclaredPackageVersion`, `MeasuredPackageVersion`, `PackageDeclarationsResponse`, `PackageMeasurementsResponse` (all `#shared/comparison.defs`); `compareDeclarations(from, to)`, `compareMeasurements(from, to)` (`server/utils/packageComparison.ts`). `PackageComparison` keeps its exact field set as `DeclarationComparison & MeasurementComparison`.

- [ ] **Step 1: Add the failing split tests**

Append to `server/utils/packageComparison.unit.ts` (the file already imports `comparePackages` and defines a `version()` fixture returning `ComparisonVersion`):

```ts
import { compareDeclarations, compareMeasurements, comparePackages } from './packageComparison';

describe('declaration and measurement split', () => {
  it('compares declarations from manifest fields without measurement evidence', () => {
    const declaredFrom = {
      name: 'example-package',
      version: '1.0.0',
      dist: { tarball: 'https://registry.npmjs.org/example-package/-/example-package-1.0.0.tgz' },
      licenses: ['MIT'],
      deprecated: false,
      engines: { node: '>=18' },
      dependencies: { dep: '^1.0.0' },
      peerDependencies: {},
      optionalDependencies: {},
      optionalPeers: [],
      installScripts: [],
      installScriptCommands: {},
      moduleFormat: { main: 'index.js' },
    };
    const declaredTo = { ...declaredFrom, version: '2.0.0', engines: { node: '>=20' } };

    expect(compareDeclarations(declaredFrom, declaredTo)).toMatchObject({
      node: { changed: true, from: '>=18', to: '>=20' },
      dependencies: [],
      peers: [],
      installScripts: [],
    });
  });

  it('splits a combined comparison into its declaration and measurement halves', () => {
    const from = version();
    const to = version({ version: '2.0.0' });

    expect(comparePackages(from, to)).toEqual({
      ...compareDeclarations(from, to),
      ...compareMeasurements(from, to),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nub exec -- vitest run server/utils/packageComparison.unit.ts`
Expected: FAIL — `compareDeclarations is not a function` (or a TypeScript import error), 7 existing tests still collected.

- [ ] **Step 3: Restructure `shared/comparison.defs.ts`**

Replace the single `PackageComparison` type with the two halves plus composition, and append the wire types. The field definitions move verbatim; nothing is retyped.

```ts
export type DeclarationComparison = {
  dependencies: DeclarationChange<DependencyRequirement>[];
  peers: DeclarationChange<PeerRequirement>[];
  node: ValueComparison<string>;
  moduleFormat: ValueComparison<ModuleDeclaration>;
  exports: ValueComparison<Exclude<ParsedPackageVersion['moduleFormat']['exports'], undefined>>;
  types: ValueComparison<TypeDeclaration>;
  licenses: { changed: boolean; from: string[]; to: string[]; added: string[]; removed: string[] };
  installScripts: DeclarationChange<string>[];
};

export type MeasurementComparison = {
  sizes: {
    unpacked: SizeComparison & { sources: { from: 'registry' | 'tarball' | null; to: 'registry' | 'tarball' | null } };
    bundle: {
      provider: 'bundlephobia';
      methodology: 'provider-estimate';
      minified: SizeComparison;
      gzip: SizeComparison;
    };
  };
  advisories: AdvisoryComparison;
};

export type PackageComparison = DeclarationComparison & MeasurementComparison;

/** Inspected-archive evidence without the per-file inventory, which stays server-side. */
export type TarballSummary = {
  status: PackageTarball['status'];
  reasons: readonly string[];
  url: string;
  fileCount: number;
  changelogCount: number;
};

/** Registry manifest fields only; what the declarations route returns per version. */
export type DeclaredPackageVersion = ParsedPackageVersion;

/** Manifest fields plus measurement evidence; what the measurements route returns per version. */
export type MeasuredPackageVersion = Omit<ComparisonVersion, 'tarball'> & { tarball: TarballSummary };

export type PackageDeclarationsResponse = {
  packageName: string;
  from: DeclaredPackageVersion;
  to: DeclaredPackageVersion;
  comparison: DeclarationComparison;
};

export type PackageMeasurementsResponse = {
  packageName: string;
  from: MeasuredPackageVersion;
  to: MeasuredPackageVersion;
  comparison: MeasurementComparison;
};
```

- [ ] **Step 4: Split `server/utils/packageComparison.ts`**

Rename the private generic `compareDeclarations` to `compareDeclarationMaps` (it maps two `ReadonlyMap`s). Retype the four helpers that only read manifest fields — `dependencies`, `peers`, `moduleDeclaration`, `typeDeclaration` — from `ComparisonVersion` to `DeclaredPackageVersion`. Then replace the exported `comparePackages` with three exports:

```ts
export function compareDeclarations(from: DeclaredPackageVersion, to: DeclaredPackageVersion): DeclarationComparison {
  const oldLicenses = [...new Set(from.licenses)].sort();
  const newLicenses = [...new Set(to.licenses)].sort();
  return {
    dependencies: compareDeclarationMaps(dependencies(from), dependencies(to)),
    peers: compareDeclarationMaps(peers(from), peers(to)),
    node: compareValue(from.engines.node, to.engines.node),
    moduleFormat: compareValue(moduleDeclaration(from), moduleDeclaration(to)),
    exports: compareValue(from.moduleFormat.exports, to.moduleFormat.exports),
    types: compareValue(typeDeclaration(from), typeDeclaration(to)),
    licenses: {
      changed: !equal(oldLicenses, newLicenses),
      from: oldLicenses,
      to: newLicenses,
      added: newLicenses.filter((license) => !oldLicenses.includes(license)),
      removed: oldLicenses.filter((license) => !newLicenses.includes(license)),
    },
    installScripts: compareDeclarationMaps(
      new Map(Object.entries(from.installScriptCommands)),
      new Map(Object.entries(to.installScriptCommands)),
    ),
  };
}

export function compareMeasurements(from: ComparisonVersion, to: ComparisonVersion): MeasurementComparison {
  return {
    sizes: compareSizes(from, to),
    advisories: compareAdvisories(from.vulnerabilities, to.vulnerabilities),
  };
}

export function comparePackages(from: ComparisonVersion, to: ComparisonVersion): PackageComparison {
  return { ...compareDeclarations(from, to), ...compareMeasurements(from, to) };
}
```

Add `DeclarationComparison`, `DeclaredPackageVersion`, and `MeasurementComparison` to the existing `#shared/comparison.defs` type import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `nub exec -- vitest run server/utils/packageComparison.unit.ts`
Expected: PASS — 9 tests (7 existing plus 2 new). The existing tests pin `comparePackages` behavior and must be unchanged.

- [ ] **Step 6: Type-check and commit**

Run: `nub run type-check`
Expected: no errors — `PackageComparison` still has the same fields, so `BriefingInput` and every consumer compile unchanged.

```bash
git add shared/comparison.defs.ts server/utils/packageComparison.ts server/utils/packageComparison.unit.ts
git commit -m "refactor: split comparison into declaration and measurement halves"
```

---

### Task 2: Contract cutover — trimmed declarations route, measurements route, tiered client

This task is one atomic contract change. Server, client, and their tests land together; the app is coherent only at the end.

**Files:**
- Modify: `server/utils/packageComparisonFacts.ts`, `server/api/package/[packageName]/compare/index.get.ts`
- Create: `server/api/package/[packageName]/compare/measurements.get.ts`
- Move: `server/api/package/[packageName]/compare/index.get.unit.ts` → `measurements.get.unit.ts` (retargeted, pruned)
- Create: `server/api/package/[packageName]/compare/index.get.unit.ts` (declaration tests), `server/utils/packageComparisonFacts.unit.ts`
- Create: `app/composables/packageMeasurementsQueryOptions.ts` + `.unit.ts`
- Modify: `app/composables/packageComparisonQueryOptions.ts`, `app/composables/useComparisonPage.ts`, `app/pages/[packageName]/comparisonView.ts`, `app/pages/[packageName]/comparisonSummary.ts`, `app/pages/[packageName]/[versionPair].vue`, `app/pages/[packageName]/comparisonView.unit.ts`
- Create: `app/pages/[packageName]/comparisonSummary.unit.ts`
- Delete: `app/composables/usePackageComparisonQuery.ts`, `app/composables/usePackageBriefingQuery.ts`

**Interfaces:**
- Consumes: Task 1's `compareDeclarations`, `compareMeasurements`, `PackageDeclarationsResponse`, `PackageMeasurementsResponse`, `TarballSummary`, `DeclaredPackageVersion`, `MeasuredPackageVersion`.
- Produces: `getComparisonDeclarations(packageName, from, to)` and `getComparisonMeasurements(packageName, from, to)` returning `Effect<PackageDeclarationsResponse, RegistryRequestError, HttpClient.HttpClient>` and `Effect<PackageMeasurementsResponse, RegistryRequestError, HttpClient.HttpClient>`; `getComparisonFacts` keeps returning `ComparisonFacts` with complete `ComparisonVersion`s; client exports `packageMeasurementsQueryOptions`, `buildComparisonRows(declarations, measurements)`, `buildComparisonSummaries({ declarations, measurements }, rows)`, and a `useComparisonPage()` that additionally exposes `declarations`, `measurements`, `isDeclarationsPending`, `isDeclarationsError`, `isMeasurementsPending`, `isMeasurementsError`.

- [ ] **Step 1: Split the server facts module**

In `server/utils/packageComparisonFacts.ts`, replace `getComparisonEvidence` and `getComparisonFacts` with the pieces below. Keep `manifestCache`, `ManifestKey`, `registryVersionManifestRequest`, both decoders, and the schemas untouched.

```ts
// Per-version lookup, shared within a request and reused across requests by `manifestCache`. Kept separate from the
// pair so each tarball can start as soon as its own manifest resolves.
const getManifest = (packageName: string, version: string) =>
  Effect.cached(Cache.get(manifestCache, new ManifestKey({ packageName, version })));

const getResolvedManifests = (packageName: string, from: string, to: string) =>
  Effect.gen(function* () {
    const fromManifest = yield* getManifest(packageName, from);
    const toManifest = yield* getManifest(packageName, to);
    return yield* Effect.cached(Effect.all({ from: fromManifest, to: toManifest }, { concurrency: 2 }));
  });

/** Manifest-only comparison; the payload the first paint depends on. */
export function getComparisonDeclarations(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<PackageDeclarationsResponse, RegistryRequestError, HttpClient.HttpClient> {
  return getResolvedManifests(packageName, from, to).pipe(
    Effect.map((manifests) => {
      const fromVersion = toPackageVersion(manifests.from);
      const toVersion = toPackageVersion(manifests.to);
      return {
        packageName,
        from: fromVersion,
        to: toVersion,
        comparison: compareDeclarations(fromVersion, toVersion),
      };
    }),
  );
}

const collectMeasurements = (packageName: string, from: string, to: string) =>
  Effect.gen(function* () {
    const fromManifest = yield* getManifest(packageName, from);
    const toManifest = yield* getManifest(packageName, to);
    const manifests = yield* Effect.cached(Effect.all({ from: fromManifest, to: toManifest }, { concurrency: 2 }));
    // Exact inputs can start measurement work before either manifest resolves; tags and ranges wait for resolution.
    const exact = isExactSemver(from) && isExactSemver(to);
    const evidence = yield* Effect.all(
      {
        tarballs: Effect.all(
          {
            from: fromManifest.pipe(Effect.flatMap(getPackageTarball)),
            to: toManifest.pipe(Effect.flatMap(getPackageTarball)),
          },
          { concurrency: 2 },
        ),
        vulnerabilities: exact
          ? getPackageVulnerabilities(packageName, from, to)
          : manifests.pipe(
              Effect.flatMap((pair) => getPackageVulnerabilities(packageName, pair.from.version, pair.to.version)),
            ),
        bundleSize: exact
          ? getPackageBundleSize(packageName, from, to)
          : manifests.pipe(
              Effect.flatMap((pair) => getPackageBundleSize(packageName, pair.from.version, pair.to.version)),
            ),
      },
      { concurrency: 3 },
    );
    const fromVersion = {
      ...toPackageVersion(manifests.from),
      vulnerabilities: evidence.vulnerabilities.from,
      bundleSize: evidence.bundleSize.from,
      tarball: evidence.tarballs.from,
    };
    const toVersion = {
      ...toPackageVersion(manifests.to),
      vulnerabilities: evidence.vulnerabilities.to,
      bundleSize: evidence.bundleSize.to,
      tarball: evidence.tarballs.to,
    };
    return { from: fromVersion, to: toVersion, comparison: compareMeasurements(fromVersion, toVersion) };
  });

const toTarballSummary = ({ status, reasons, url, files, changelogs }: PackageTarball): TarballSummary => ({
  status,
  reasons,
  url,
  fileCount: files.length,
  changelogCount: changelogs.length,
});

const toMeasuredVersion = ({ tarball, ...version }: ComparisonVersion): MeasuredPackageVersion => ({
  ...version,
  tarball: toTarballSummary(tarball),
});

/** Measurement evidence for a resolved pair; the per-file inventory stays server-side. */
export function getComparisonMeasurements(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<PackageMeasurementsResponse, RegistryRequestError, HttpClient.HttpClient> {
  return collectMeasurements(packageName, from, to).pipe(
    Effect.map(({ from: fromVersion, to: toVersion, comparison }) => ({
      packageName,
      from: toMeasuredVersion(fromVersion),
      to: toMeasuredVersion(toVersion),
      comparison,
    })),
  );
}

/** Complete facts for the briefing evidence packet; not exposed as a route. */
export function getComparisonFacts(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<ComparisonFacts, RegistryRequestError, HttpClient.HttpClient> {
  return Effect.all(
    {
      declarations: getComparisonDeclarations(packageName, from, to),
      measurements: collectMeasurements(packageName, from, to),
      releaseNotes: getResolvedManifests(packageName, from, to).pipe(
        Effect.flatMap((pair) => getPackageReleaseNotes(packageName, pair.from, pair.to, process.env.GITHUB_TOKEN)),
      ),
    },
    { concurrency: 3 },
  ).pipe(
    Effect.map(({ declarations, measurements, releaseNotes }) => ({
      packageName,
      releaseNotes,
      from: measurements.from,
      to: measurements.to,
      comparison: { ...declarations.comparison, ...measurements.comparison },
    })),
  );
}
```

Add `PackageTarball`, `ComparisonVersion`, `PackageDeclarationsResponse`, `PackageMeasurementsResponse`, `TarballSummary`, `MeasuredPackageVersion` to the imports; add `compareDeclarations`, `compareMeasurements` to the `./packageComparison` import; `comparePackages` is no longer imported here.

- [ ] **Step 2: Point the routes at the new functions**

`server/api/package/[packageName]/compare/index.get.ts` — swap `getComparisonFacts` for `getComparisonDeclarations` and update the import:

```ts
import { getComparisonDeclarations } from '../../../../utils/packageComparisonFacts';

export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  return Effect.runPromise(
    getComparisonDeclarations(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)),
  );
});
```

`server/api/package/[packageName]/compare/measurements.get.ts` — new file, same validation, measurements function:

```ts
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
  getComparisonMeasurements,
} from '../../../../utils/packageComparisonFacts';

// Sizes, advisories, and inspected-archive summaries for a resolved pair. Kept off the comparison route so a slow
// provider cannot delay declarations.
export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  return Effect.runPromise(
    getComparisonMeasurements(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)),
  );
});
```

- [ ] **Step 3: Retarget the evidence tests to the measurements route**

```bash
git mv server/api/package/[packageName]/compare/index.get.unit.ts server/api/package/[packageName]/compare/measurements.get.unit.ts
```

In the moved file:
1. `import type endpointHandler from './index.get'` → `'./measurements.get'`.
2. `startRequest` path: `/api/package/${encodeURIComponent(packageName)}/compare` → `/api/package/${encodeURIComponent(packageName)}/compare/measurements`.
3. Delete the `describe('factual comparison')` block (moves to Step 4).
4. Delete the four GitHub-dependent tests from `describe('comparison request scheduling')`: `starts GitHub evidence while OSV is pending`, `preserves npm and OSV evidence without GitHub requests for other hosts`, `fetches the pinned changelog body before release pagination finishes`, `keeps invalid optional repository metadata from failing the comparison`, and `retains registry and OSV results when GitHub is rate limited` (moves to Step 5). Keep `starts both npm requests and finishes unique OSV lookups while npm is still pending` and `fetches both manifests concurrently but resolves tags before its single OSV batch`.
5. In `describe('evidence caching')`, remove the GitHub URL from the expected fetch list — the measurements route makes no GitHub call:

```ts
    expect(fetchMock.mock.calls.map(([input, init]) => new Request(input, init).url).sort()).toEqual([
      'https://api.osv.dev/v1/querybatch',
    ]);
```

6. In `describe('tarball evidence')`, the response no longer carries the inventory. Replace the expectation with summary fields:

```ts
    expect(await pending).toMatchObject({
      from: { tarball: { status: 'available', changelogCount: 1 }, vulnerabilities: { count: 0 } },
      to: { version: '1.2.8', tarball: { status: 'available', changelogCount: 1 }, vulnerabilities: { count: 0 } },
    });
```

7. In `describe('local comparison')`, delete the `sizes` and `advisories` keys from the expectation (declarations belong to the comparison route) and keep only the declaration assertions. Rename the describe to `describe('measurement comparison')` and add:

```ts
  it('reports sizes and advisories independently of declarations', async () => {
    installCacheFixtures(await cacheFixtureTarball());
    const response = await startRequest('1.0.0', '2.0.0');

    expect(response).toMatchObject({
      from: { version: '1.0.0', tarball: { status: 'available', fileCount: expect.any(Number) } },
      to: { version: '2.0.0', bundleSize: { status: 'available' } },
      comparison: {
        sizes: { unpacked: { status: 'available' }, bundle: { provider: 'bundlephobia' } },
        advisories: { status: 'available' },
      },
    });
    expect(response).not.toHaveProperty('releaseNotes');
    expect(JSON.stringify(response)).not.toContain('"files"');
  });
```

- [ ] **Step 4: Write the declarations route tests**

Create `server/api/package/[packageName]/compare/index.get.unit.ts` with the declarations-focused coverage (same `mockEvent`/`registry` harness as the moved file, path `/api/package/{pkg}/compare`):

```ts
describe('declaration comparison', () => {
  it('returns manifest declarations without measurement or release evidence', async () => {
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/1.0.0') ? '1.0.0' : '2.0.0'),
      engines: { node: path.endsWith('/1.0.0') ? '>=18' : '>=20' },
      repository: { type: 'git', url: 'git+https://github.com/minimistjs/minimist.git' },
    }));
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));

    const response = await startRequest('1.0.0', '2.0.0');

    expect(response).toMatchObject({
      packageName: 'minimist',
      from: { version: '1.0.0' },
      to: { version: '2.0.0' },
      comparison: { node: { changed: true, from: '>=18', to: '>=20' } },
    });
    expect(response).not.toHaveProperty('releaseNotes');
    expect(response.from).not.toHaveProperty('tarball');
    expect(response.from).not.toHaveProperty('vulnerabilities');
    expect(response.from).not.toHaveProperty('bundleSize');
    expect(response.comparison).not.toHaveProperty('sizes');
    expect(response.comparison).not.toHaveProperty('advisories');
  });

  it('resolves tags to exact versions without measurement providers', async () => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/latest') ? '2.0.0' : '1.0.0'));
    fetchMock.mockImplementation(async () => {
      throw new Error('the declarations route must not call evidence providers');
    });

    expect(await startRequest('1.0.0', 'latest')).toMatchObject({ to: { version: '2.0.0' } });
  });

  it('never calls the AI provider and omits the briefing field', async () => {
    // Port the existing assertion from the moved file: AI env is set, the response has no briefing, no provider call.
  });
});
```

- [ ] **Step 5: Move the release-note scheduling tests to a facts test**

Create `server/utils/packageComparisonFacts.unit.ts` and port the five GitHub tests from the moved file, calling the function directly instead of through a route:

```ts
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getComparisonFacts as getComparisonFactsType } from './packageComparisonFacts';

const registry = vi.hoisted(() => ({ json: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock('npm-registry-fetch', () => ({ default: registry }));

const fetchMock = vi.fn<typeof fetch>();
let getComparisonFacts: typeof getComparisonFactsType;

const startFacts = (from: string, to: string, packageName = 'minimist') =>
  Effect.runPromise(getComparisonFacts(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)));

beforeEach(async () => {
  // Reload the module boundary so each test owns fresh process-local caches.
  vi.resetModules();
  ({ getComparisonFacts } = await import('./packageComparisonFacts'));
  registry.json.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
```

Port these five tests verbatim apart from the invocation and the assertions listed:
- `starts GitHub evidence while OSV is pending for %s` — keep the gate/waitFor structure; final assertion becomes `expect(await pending).toMatchObject({ releaseNotes: { status: 'partial', releases: [{ version: '1.2.8', body: 'Release fixes' }] }, to: { version: '1.2.8', vulnerabilities: { status: 'available', count: 0 } } })`.
- `preserves npm and OSV evidence without GitHub requests for other hosts` — assertions unchanged (`releaseNotes` and `to.vulnerabilities` are both on `ComparisonFacts`).
- `fetches the pinned changelog body before release pagination finishes` — unchanged.
- `keeps invalid optional repository metadata from failing the comparison` — unchanged.
- `retains registry and OSV results when GitHub is rate limited` — unchanged.

Run: `nub exec -- vitest run server/utils/packageComparisonFacts.unit.ts server/api/package/[packageName]/compare/measurements.get.unit.ts server/api/package/[packageName]/compare/index.get.unit.ts`
Expected: PASS. Any failure here is a real behavior change in the split, not a test-fixture problem.

- [ ] **Step 6: Add the measurements query options**

Create `app/composables/packageMeasurementsQueryOptions.ts` (mirror `packageComparisonQueryOptions.ts`; same normalization, `staleTime`, `retry`, `refetchOnWindowFocus`, and client `gcTime`):

```ts
export const PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX = ['npm', 'packages', 'measurements'] as const;
```

```ts
    // Measurements are client-only: awaiting declarations during SSR would otherwise enable this query and collect
    // tarballs, OSV, and Bundlephobia evidence on the server for every page view.
    enabled: computed(
      () =>
        import.meta.client &&
        normalizedPackageName.value.length > 0 &&
        normalizedFromVersion.value.length > 0 &&
        normalizedToVersion.value.length > 0,
    ),
```

```ts
      return requestFetch<PackageMeasurementsResponse>(
        `/api/package/${encodeURIComponent(packageName)}/compare/measurements`,
        { query: { from, to }, retry: false, signal },
      );
```

Create `app/composables/packageMeasurementsQueryOptions.unit.ts` asserting the key `['npm', 'packages', 'measurements', 'react', '19.0.0', '19.3.0']` and that the query stays disabled outside the browser (`import.meta.client` is undefined under the node test environment), which is the gate that keeps measurements off the server.

Apply the same client gate to the `enabled` computed in `app/composables/packageBriefingQueryOptions.ts`, with the reason stated in a comment: with declarations awaited during SSR, the briefing query would otherwise enable server-side and spend a model call on every page view. Update `app/composables/packageBriefingQueryOptions.unit.ts` to assert the key as it does today plus `expect(toValue(options.enabled)).toBe(false)` under the node environment.

In `app/composables/packageComparisonQueryOptions.ts`, delete the local `PackageComparisonResponse = BriefingInput` alias and import `PackageDeclarationsResponse` from `#shared/comparison.defs` instead; the `requestFetch<...>` call site keeps its shape and the endpoint path stays `/api/package/${encodeURIComponent(packageName)}/compare`.

Run: `nub exec -- vitest run app/composables/packageMeasurementsQueryOptions.unit.ts app/composables/packageComparisonQueryOptions.unit.ts`
Expected: PASS.

- [ ] **Step 7: Rewrite the page composable**

Replace `app/composables/useComparisonPage.ts` (delete `usePackageComparisonQuery.ts` and `usePackageBriefingQuery.ts`):

```ts
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';

import { useRequestFetch, useRoute } from '#imports';
import { packageBriefingQueryOptions } from '~/composables/packageBriefingQueryOptions';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import { packageMeasurementsQueryOptions } from '~/composables/packageMeasurementsQueryOptions';
import { buildBriefingCitations, resolvedBriefingVersions } from '~/pages/[packageName]/comparisonView';

export const useComparisonPage = async () => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const requestFetch = useRequestFetch();
  const queryClient = useQueryClient();

  // Every query is created before the server prefetch below: vue-query resolves its client through injection, so it
  // must run inside the synchronous setup scope, never after an await.
  const declarationsOptions = packageComparisonQueryOptions(requestFetch, packageName, fromVersion, toVersion);
  const declarationsQuery = useQuery(declarationsOptions);
  const declarations = computed(() => declarationsQuery.data.value);
  const resolved = computed(() => resolvedBriefingVersions(declarations.value));
  const resolvedFrom = computed(() => resolved.value.from);
  const resolvedTo = computed(() => resolved.value.to);
  const measurementsQuery = useQuery(packageMeasurementsQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo));
  const briefingQuery = useQuery(packageBriefingQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo));

  if (import.meta.server) {
    // Declarations must be in the first paint. A failed prefetch is not dehydrated, so drop it and let the client
    // retry from a pending state instead of hydrating an error the server already rendered.
    await queryClient.prefetchQuery(declarationsOptions);
    if (queryClient.getQueryState(declarationsOptions.queryKey)?.status !== 'success') {
      queryClient.removeQueries({ queryKey: declarationsOptions.queryKey });
    }
  }

  const briefing = computed(() => briefingQuery.data.value?.briefing);

  return {
    packageName,
    displayFromVersion: computed(() => declarations.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => declarations.value?.to.version ?? toVersion.value),
    declarations,
    measurements: computed(() => measurementsQuery.data.value),
    isDeclarationsPending: computed(() => declarationsQuery.isPending.value),
    isDeclarationsError: computed(() => declarationsQuery.isError.value),
    isMeasurementsPending: computed(() => measurementsQuery.isPending.value),
    isMeasurementsError: computed(() => measurementsQuery.isError.value),
    briefing,
    isBriefingPending: computed(() => briefingQuery.isPending.value),
    briefingError: computed(() => briefingQuery.error.value),
    sources: computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : [])),
    citations: computed(() => {
      const value = briefing.value;
      return value?.status === 'available' ? buildBriefingCitations(value.sources, value.bullets) : [];
    }),
  };
};
```

`useComparisonRoute` stays as it is. `buildComparisonRows` is no longer imported here; the page builds rows. Note that the page must `await` this composable (Step 10) — the SFC compiler wraps a top-level await in `withAsyncContext`, so the page's own continuation keeps its component instance.

- [ ] **Step 8: Make the row builders tier-aware**

In `app/pages/[packageName]/comparisonView.ts`:
1. `formatTarball(version: MeasuredPackageVersion)` — replace `version.tarball.files.length` with `version.tarball.fileCount` and `version.tarball.changelogs.length` with `version.tarball.changelogCount`.
2. `resolvedBriefingVersions` takes any version pair, so declarations can feed it:

```ts
export function resolvedBriefingVersions(
  comparison: { from: { version: string }; to: { version: string } } | undefined,
): { from: string; to: string } {
  return comparison === undefined ? { from: '', to: '' } : { from: comparison.from.version, to: comparison.to.version };
}
```

3. `declarationRows(from: DeclaredPackageVersion, to: DeclaredPackageVersion, comparison: DeclarationComparison)` — the existing three plus five declaration rows, unchanged.
4. Replace `sizeRows`/`evidenceRows` with one pending-aware builder:

```ts
export const MEASURING_VALUE = 'Measuring…';

const measured = (measurements: PackageMeasurementsResponse | undefined, read: (value: PackageMeasurementsResponse) => string) =>
  measurements === undefined ? MEASURING_VALUE : read(measurements);

const measurementRows = (measurements: PackageMeasurementsResponse | undefined): readonly ComparisonRow[] => {
  const sizes = measurements?.comparison.sizes;
  return [
    row(
      'comparison.sizes-unpacked',
      'Unpacked package size',
      measured(measurements, () => formatBytes(sizes?.unpacked.from ?? null)),
      measured(measurements, () => formatBytes(sizes?.unpacked.to ?? null)),
      sizes !== undefined && sizes.unpacked.delta !== 0,
      sizes === undefined ? '' : formatDelta(sizes.unpacked),
    ),
    // minified, gzip, advisories, and tarball rows follow the same shape; their resolved values keep the current
    // formatters (formatBundleSize, formatAdvisories, formatTarball) and their `changed` expressions unchanged.
  ];
};

export function buildComparisonRows(
  declarations: PackageDeclarationsResponse,
  measurements: PackageMeasurementsResponse | undefined,
): readonly ComparisonRow[] {
  return [
    ...declarationRows(declarations.from, declarations.to, declarations.comparison),
    ...measurementRows(measurements),
  ];
}
```

The five measurement rows keep today's labels, anchors (`comparison.sizes-unpacked`, `comparison.sizes-minified`, `comparison.sizes-gzip`, `comparison.advisories`, `comparison.tarball`), order, `detail` strings, and `changed` expressions; only the values become pending-aware.

- [ ] **Step 9: Make the summaries tier-aware**

In `app/pages/[packageName]/comparisonSummary.ts`:
1. `declarationSummaries` takes `DeclaredPackageVersion`.
2. `evidenceSummary(version: MeasuredPackageVersion | DeclaredPackageVersion, sourceId, original)` — the tarball branch uses `fileCount`:

```ts
  if (sourceId === 'comparison.tarball') {
    const { status, fileCount } = version.tarball;
    return status === 'unavailable' ? 'Unavailable' : `${fileCount} files${status === 'available' ? '' : ' · partial coverage'}`;
  }
```

3. `buildComparisonSummaries` takes the tiered input and returns pending presentation when measurements are absent:

```ts
export type ComparisonSummaryInput = {
  declarations: PackageDeclarationsResponse;
  measurements: PackageMeasurementsResponse | undefined;
};

export function buildComparisonSummaries(input: ComparisonSummaryInput, rows: readonly ComparisonRow[]) {
  const measurements = input.measurements;
  const sizes: Record<string, SizeComparison> = measurements === undefined
    ? {}
    : {
        'comparison.sizes-unpacked': measurements.comparison.sizes.unpacked,
        'comparison.sizes-minified': measurements.comparison.sizes.bundle.minified,
        'comparison.sizes-gzip': measurements.comparison.sizes.bundle.gzip,
      };
  return rows.map((row) => {
    const size = sizes[row.sourceId];
    const pending = row.from === MEASURING_VALUE && row.to === MEASURING_VALUE;
    const presentation = pending
      ? { from: MEASURING_VALUE, to: MEASURING_VALUE, changed: false, note: '', showNote: false }
      : rowPresentation(row, input, size);
    const isBundle = row.sourceId === 'comparison.sizes-minified' || row.sourceId === 'comparison.sizes-gzip';
    const withEstimateNote = isBundle && measurements !== undefined;
    return {
      row,
      ...presentation,
      fromNote: withEstimateNote ? incompleteEstimate(measurements.from) : '',
      toNote: withEstimateNote ? incompleteEstimate(measurements.to) : '',
      anchor: row.sourceId === 'comparison.sizes-unpacked' ? 'comparison-sizes' : row.id,
      expandable:
        presentation.from !== row.from ||
        presentation.to !== row.to ||
        row.detail.length > 0 ||
        row.from.includes('\n') ||
        row.to.includes('\n'),
    };
  });
}
```

`rowPresentation(row: ComparisonRow, input: ComparisonSummaryInput, size: SizeComparison | undefined)` reads: size rows from `size`, the advisories and tarball rows from `input.measurements` (`from`/`to` are `MeasuredPackageVersion`, so `vulnerabilities` and the tarball summary are available), and every other row from `input.declarations`. `incompleteEstimate` takes `MeasuredPackageVersion`. `sizeChange`, `readableSize`, and the declaration summaries keep their current bodies. Import `MEASURING_VALUE` from `./comparisonView`; drop the `BriefingInput` import.

- [ ] **Step 10: Wire the page template**

In `app/pages/[packageName]/[versionPair].vue`:
1. The composable is now async because it awaits the server prefetch, so the page awaits it:

```ts
const {
  packageName,
  displayFromVersion,
  displayToVersion,
  declarations,
  measurements,
  isDeclarationsPending,
  isDeclarationsError,
  isMeasurementsPending,
  briefing,
  isBriefingPending,
  briefingError,
  sources,
  citations,
} = await useComparisonPage();
```

2. Rows:

```ts
const rows = computed(() =>
  declarations.value
    ? buildComparisonSummaries(
        { declarations: declarations.value, measurements: measurements.value },
        buildComparisonRows(declarations.value, measurements.value),
      )
    : [],
);
```

3. Loading and error conditions use `isDeclarationsPending` / `isDeclarationsError`; the content branch is `v-else-if="declarations"`.
4. Declaration-derived values read `declarations.value.comparison...` (`node.changed`, `dependencies.length`).
5. Security tile reads the measurements tier; keep the existing `Checking…` default while pending:

```ts
const security = computed(() => {
  const measured = measurements.value;
  if (!measured) return { value: 'Checking…', detail: '' };
  const { status, count } = measured.to.vulnerabilities;
  if (status !== 'available' || count === null)
    return { value: 'Incomplete coverage', detail: 'No safety conclusion can be drawn.' };
  return {
    value: `${count} matched ${count === 1 ? 'advisory' : 'advisories'}`,
    detail: `For ${measured.to.version} · not a guarantee of safety`,
  };
});
```

6. Gzip tile: `measurements.value === undefined ? 'Measuring…' : sizeChange(measurements.value.comparison.sizes.bundle.gzip)`, keeping the `text-change` class condition on the delta.
7. Category counter — never final while measurements are pending:

```html
            <p class="text-xs leading-normal text-muted-foreground">
              {{ isMeasurementsPending ? 'Measuring remaining categories…' : `${changedCount} of ${rows.length} categories changed` }}
            </p>
```

8. The briefing block and citations keep using the composable's `briefing`, `isBriefingPending`, `briefingError`, `citations`; the anchors `#comparison-dependencies`, `#comparison-sizes-gzip`, `#comparison-advisories` must stay valid.

- [ ] **Step 11: Update the client tests**

`app/pages/[packageName]/comparisonView.unit.ts`:
- Split `makeVersion` into `makeDeclaredVersion(version, overrides)` (`ParsedPackageVersion`) and `makeMeasuredVersion(version, overrides)` (`MeasuredPackageVersion`, tarball as `{ status, reasons, url, fileCount: 0, changelogCount: 0 }`).
- Keep the citation tests unchanged.
- Add:

```ts
  it('labels measurement rows as pending until the measurements tier resolves', () => {
    const rows = buildComparisonRows(declarationsFixture, undefined);

    expect(rows.map((row) => row.id)).toEqual([
      'comparison-dependencies',
      'comparison-peers',
      'comparison-node',
      'comparison-module-format',
      'comparison-exports',
      'comparison-types',
      'comparison-licenses',
      'comparison-install-scripts',
      'comparison-sizes-unpacked',
      'comparison-sizes-minified',
      'comparison-sizes-gzip',
      'comparison-advisories',
      'comparison-tarball',
    ]);
    expect(rows.slice(8).map((row) => [row.from, row.to])).toEqual(Array.from({ length: 5 }, () => ['Measuring…', 'Measuring…']));
    expect(rows.slice(8).every((row) => row.changed === false)).toBe(true);
  });

  it('fills measurement rows from the measurements tier', () => {
    const rows = buildComparisonRows(declarationsFixture, measurementsFixture);

    expect(rows.find((row) => row.id === 'comparison-sizes-gzip')).toMatchObject({ changed: true });
    expect(rows.find((row) => row.id === 'comparison-tarball')?.from).toContain('files');
  });
```

Create `app/pages/[packageName]/comparisonSummary.unit.ts` with two tests: pending rows present as `Measuring…` with `expandable: false`, and resolved rows present readable sizes plus the delta note (`sizeChange`) and the `Incomplete estimate` note only for bundle rows whose build omitted dependencies.

Run: `nub exec -- vitest run app/pages/[packageName]/comparisonView.unit.ts app/pages/[packageName]/comparisonSummary.unit.ts`
Expected: PASS.

- [ ] **Step 12: Full verification of the cutover**

Run: `nub run test`
Expected: PASS, all suites.

Run: `nub run type-check`
Expected: no errors. This is the step that proves the client and server contracts line up.

Then smoke it in the dev server: start `nub run dev` through the hub tool (`op: start`, `name: cutover-dev`, `application: nub`, `args: ["run", "dev"]`, ready on port 5173 with the `Local:` banner), then:

```bash
curl -s 'http://127.0.0.1:5173/api/package/lodash/compare?from=4.17.20&to=4.17.21' | head -c 400
curl -s 'http://127.0.0.1:5173/api/package/lodash/compare/measurements?from=4.17.20&to=4.17.21' | head -c 400
```

Expected: the declarations payload has `comparison.dependencies`/`node` and no `releaseNotes`, `sizes`, `advisories`, or tarball inventory; the measurements payload has `comparison.sizes`, `comparison.advisories`, and `tarball` summaries with `fileCount`/`changelogCount`. Then load `http://127.0.0.1:5173/lodash/4.17.20...4.17.21` in the browser tool and confirm the table renders with real values and no console errors. Stop the dev server afterwards.

Then prove the server does not collect measurements or briefings. Run the built server twice — one instance that serves a page request for a pair and one that serves none — and compare a cold `/compare/measurements` call on each:

```bash
nub run build
# instance A on port 3100, instance B on port 3102, started through the hub tool as in Task 3
curl -s -o /dev/null -w 'A page: %{time_starttransfer}s\n' 'http://127.0.0.1:3100/lodash/4.17.20...4.17.21'
curl -s -o /dev/null -w 'A measurements: %{time_starttransfer}s\n' 'http://127.0.0.1:3100/api/package/lodash/compare/measurements?from=4.17.20&to=4.17.21'
curl -s -o /dev/null -w 'B measurements (cold): %{time_starttransfer}s\n' 'http://127.0.0.1:3102/api/package/lodash/compare/measurements?from=4.17.20&to=4.17.21'
```

Expected: A and B are both slow (hundreds of milliseconds), i.e. the page request did not warm the measurements tier. Contrast with the declarations route, where A is warm after the page request and B is cold — that asymmetry is the proof that declarations are prefetched server-side and measurements are not. Also confirm no provider call is made for the briefing during the page request (the AI settings can stay unset; a server-side briefing attempt would surface as a provider or configuration error in the page payload's vue-query state, which must be absent).

- [ ] **Step 13: Commit the cutover**

```bash
git add -A
git commit -m "feat: serve comparison declarations separately from measurements"
```

---

### Task 3: Enable streaming SSR

**Files:**
- Modify: `nuxt.config.ts`

**Interfaces:**
- Consumes: Task 2's server prefetch inside `useComparisonPage`.
- Produces: streamed HTML responses for the comparison page (shell first, body when the prefetch resolves).

- [ ] **Step 1: Enable the flag**

Add to `nuxt.config.ts` alongside the existing top-level options:

```ts
  experimental: {
    // Stream the shell before the awaited declarations prefetch resolves; Nuxt excludes crawler user agents.
    ssrStreaming: true,
  },
```

- [ ] **Step 2: Verify the streamed response**

```bash
nub run build
```

Start the built server through the hub tool (`op: start`, `name: streaming-preview`, `application: node`, `args: [".output/server/index.mjs"]`, `env: { PORT: "3100", NITRO_PORT: "3100" }`, ready on port 3100), then:

```bash
curl -s -N 'http://127.0.0.1:3100/lodash/4.17.20...4.17.21' -o /tmp/streamed.html -w 'ttfb=%{time_starttransfer}s total=%{time_total}s\n'
grep -c 'Compare releases' /tmp/streamed.html
grep -c 'Reading package declarations and published evidence' /tmp/streamed.html
```

Expected: TTFB well below total; `Compare releases` present (declarations are in the HTML); the loading sentence count is 0.

- [ ] **Step 3: Confirm crawler and hydration behavior**

Curl the same URL with a bot user agent and confirm the response is a single complete render (no streaming bootstrap script, declarations present). Then load the page in the browser tool and confirm no hydration warnings in the console and exactly one `/compare` request in the network log.

- [ ] **Step 4: Commit**

```bash
git add nuxt.config.ts
git commit -m "perf: stream the comparison shell before declarations resolve"
```

---

### Task 4: Documentation and acceptance measurement

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the shipped routes and page behavior from Tasks 1–3.
- Produces: updated response-shape documentation and a recorded before/after measurement.

- [ ] **Step 1: Update the README response sections**

- Comparison route section: state that `/compare` returns `{ packageName, from, to, comparison }` with declaration fields only (`dependencies`, `peers`, `node`, `moduleFormat`, `exports`, `types`, `licenses`, `installScripts`), that `releaseNotes` and measurement evidence moved, and that the route makes no GitHub request.
- New measurements route section: `/compare/measurements` returns `{ packageName, from, to, comparison: { sizes, advisories }, from.tarball, to.tarball }` with `TarballSummary` (`status`, `reasons`, `url`, `fileCount`, `changelogCount`) for a resolved pair, and note that the per-file inventory stays server-side for briefing evidence packing.
- "Published npm tarballs" section: replace the documented `files`/`changelogs` response fields with the summary fields and note where they are served.
- "Local comparison" section: move `sizes`/`advisories` under the measurements route.
- UI section: describe tiered loading — declarations in the first HTML via streaming SSR and the server prefetch, measurements and AI notes filling in afterwards, `Measuring…` pending rows.
- "Process-local evidence caches" section: note that both routes read the same caches, so a page load collects each version's manifest once.
- Briefing section: note release notes are collected for inference only and appear solely as `maintainer` sources.

- [ ] **Step 2: Run the acceptance harness**

Build, start the preview, then measure with the browser tool exactly as the spec's baseline was measured (Fast 3G: 150 ms latency, 1.6 Mbps down, 750 kbps up; cold process):

```js
const tab = await browser.open({ name: 'acceptance', url: 'http://127.0.0.1:3100/lodash/4.17.20...4.17.21' });
```

Record: time until the declaration table is visible, time until the measurement rows leave `Measuring…`, the declarations response size on the wire, and the full resource list. Expected against the recorded baseline (facts visible at 4.29 s, 293,657 B payload):

- declaration rows visible under 1.2 s;
- no full-page loading sentence at any point;
- declaration payload ≤ 40 KB raw;
- measurement rows fill in without interaction.

Also verify the warm path: reload once and confirm no pending state for declarations.

- [ ] **Step 3: Record results and commit**

Append an `### After (2026-09-22)` subsection to §1 of `docs/superpowers/specs/2026-09-22-progressive-comparison-loading-design.md` with the observed numbers — declaration rows visible, measurement rows resolved, declarations payload size, and TTFB versus total on the streamed response. Do not restate the baseline as the new result, and do not add a changelog file.

```bash
git add README.md docs/superpowers/specs/2026-09-22-progressive-comparison-loading-design.md
git commit -m "docs: document tiered comparison responses and measured loading"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §4.1 declarations route (no `releaseNotes`, no inventory, no GitHub) | 2 (Steps 1, 2, 3, 4) |
| §4.2 measurements route and `TarballSummary` | 2 (Steps 1, 2, 3, 6) |
| §4.3 briefing and cache behavior unchanged | 2 (Steps 1, 5) |
| §5 tiered rendering, pending labels, counter rule, per-row degradation | 2 (Steps 8, 9, 10, 11) |
| §6 streaming SSR, bots, prefetch without a second request, client-only later tiers | 2 (Steps 6, 7, 12), 3 |
| §1 cause 4 (server-side work is paid and discarded today) | 2 (Steps 6, 7), verified in 2 Step 12 |
| §7 failure matrix | 2 (Steps 4, 5) |
| §8 tests and acceptance proof | 2 (Steps 3–5, 11, 12), 4 (Step 2) |
| §9 out of scope (no compression, no prefetch on home, no file-diff UI) | Global Constraints |
| §10 risks (contract break, SSR cost, Bundlephobia expectation) | 4 (Step 1) |

**Placeholder scan:** no TBD/TODO. The two places that reference existing code rather than restating it are the measurement row bodies in Task 2 Step 8 and the five ported GitHub tests in Task 2 Step 5; both name the exact existing symbols, files, and the assertions that change, so the executor edits code that is already in the repository rather than inventing it.

**Type consistency:** `PackageDeclarationsResponse`/`PackageMeasurementsResponse` are defined in Task 1 and consumed unchanged in Tasks 2–4; `buildComparisonRows(declarations, measurements)` and `buildComparisonSummaries({ declarations, measurements }, rows)` signatures match between Task 2 Steps 8, 9, and 10; `TarballSummary.fileCount`/`changelogCount` are used consistently in `formatTarball`, `evidenceSummary`, and the endpoint tests; `MEASURING_VALUE` is exported once from `comparisonView.ts` and reused by `comparisonSummary.ts`.
