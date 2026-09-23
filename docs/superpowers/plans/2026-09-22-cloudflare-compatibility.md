# Cloudflare Compatibility — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Status:** Milestone 1 implemented and verified locally; independent spec and quality reviews passed. No production deployment occurred. Later queue/client milestones and production rollout still require their own approval.

**Goal:** Run the real application under local Cloudflare `workerd`, with public npm transport and D1 briefing persistence, while retaining Nuxt HMR and all current briefing/evidence contracts.

**Architecture:** Replace the npm client with the existing Effect HTTP pattern and replace the local native SQLite application store with a request-bound D1 store. Use Nitro 2's Cloudflare binding proxy for development and Wrangler against the actual built Worker for production-runtime verification. The current GET briefing route stays synchronous in this milestone; global inference coordination is M2, not an implicit property of D1.

**Tech Stack:** Nuxt 4.5.2, Nitro 2.13.4, Vue 3.5, Effect 4.0.0-rc.115, H3 2 through Nuxt, Node 26, Wrangler 4.136.1, local D1/Miniflare, Vitest 5, Nub.

**Spec:** `docs/superpowers/specs/2026-09-22-cloudflare-briefing-migration-design.md`, particularly §§3, 9–11.

## Global Constraints

- Preserve the current GET briefing request/response, client behaviour, evidence packing, and provider validation during M1.
- The successful-result key remains SHA-256 of `JSON.stringify(buildBriefingEvidence(input))`; no TTL or model/prompt/credential invalidation.
- Replace native libSQL with D1 as the sole application briefing store; no dual-store fallback or native database dependency in the Worker graph.
- Preserve existing `.data/briefings.db` and provide an explicit read-only export/import path for already-paid results.
- Missing bindings and failed D1 reads (including absent schema or corrupt saved results) fail closed as `cache-error` before inference. Failed writes must not be presented as durable success; a failure after generation cannot undo provider spend.
- Use public npm HTTPS registry transport through the existing Effect HTTP client pattern; remove `npm-registry-fetch` and its type dependency, not just its native optional modules.
- Use Nuxt 4.5.2, Nitro 2.13.4, Effect 4.0.0-rc.115, Wrangler 4.136.1, Node 26, and compatibility date 2026-09-16 as the implementation baseline; do not combine this milestone with framework upgrades. Wrangler is pinned one patch below the spike's 4.136.2 to respect the existing 24-hour package-maturity policy; both use Miniflare 5.20260921.0-alpha.
- Keep real D1 local emulation and production-preview verification; do not substitute an in-memory application store.
- No Queues, Durable Objects, WebSocket feature, paid AI smoke calls, or remote-resource creation in M1.
- No application implementation starts until the design and M1 plan are approved.

Additional execution rules:

- Planning is on `main`; implementation defaults to a dedicated worktree after approval, unless the user explicitly chooses otherwise. Do not change branch while only reviewing these documents.
- Use `nub` and `nub.lock`, not npm/pnpm lockfiles. Run Nuxt under plain Node (`nub run --node ...`); Node 26 is already pinned by `.node-version`.
- Unit tests stub external HTTP. D1 tests use actual local Miniflare databases in isolated temporary directories. Dispose runtimes and restore globals/timers even on failure.
- Request bindings never become a mutable global `currentDatabase`. Scope the existing in-memory inference caches to the D1 binding so different databases cannot share results or writes.
- Missing binding, missing schema, corrupt persisted JSON, and write failure remain failures, not cache misses.
- No no-op native-module aliases, fake tarball fallback, or compatibility shims that suppress failures. Keep `nodejs_compat` for supported Node APIs and verify their actual behaviour.
- Run format/lint/type checks once after integrated changes; agents do not run project-wide validation concurrently. Targeted behavioural tests belong to the owning task. A conventional commit is made only after each task's gate/review; never commit a half-migrated API/storage boundary.
- The new development packages are Wrangler 4.136.1, Miniflare 5.20260921.0-alpha (the version used by the spike's Wrangler), and `@cloudflare/workers-types` 5.20260922.1 (type-only imports). Pin these initial versions and record any necessary version adjustment rather than silently upgrading the runtime. The Miniflare prerelease is explicit, not an assertion of production stability.

## Runtime findings and execution refinements

The actual application gate exposed two Worker incompatibilities, not ordinary upstream failures:

- `workerd` rejects `fetch`'s `redirect: 'error'`. Tarball, GitHub, and provider requests use `manual` with their existing non-2xx rejection and explicit zero-follow policy. Real tarballs and a redirect fixture verified inspection and no target contact.
- Effect 4.0.0-rc.115's pending `Cache` waiters use a fiber observer that loses the waiting request's context. Four concurrent application requests produced one 200 and three 500/hung responses. `patches/effect@4.0.0-rc.115.patch` bridges the shared pending Exit through a native promise while retaining cache/refcount semantics. Cross-request promise safety stays enabled. A real-workerd regression covers concurrent callers and initiating-caller cancellation; it fails against the original implementation. Existing Node/stubbed suites cannot expose this platform boundary, so the regression has its own suite and test-only Worker fixture.

The Vite checker also failed on the one-line `@typescript/typescript6` facade and missed a deliberate Vue type error. Pinning `typescript@6.0.3`, the compiler that facade already loaded, restored cold-start diagnostics without a compiler/framework upgrade. The existing Nuxt Node type project now includes offline scripts and test helpers/fixtures. `shared/cloudflare.d.ts` types the request-bound D1 context across Nuxt's server and typed-route consumer projects without an unsafe assertion or runtime shim.

The copied storage constraint is clarified to match the original spec §3 contract: failed reads prevent inference; failed writes cannot be called durable success, but cannot undo an already-completed provider call. Execution evidence and review rulings live in the ignored per-plan ledger.

## Deliverable boundaries and file ownership

| Task | Owns | Reviewable result |
| --- | --- | --- |
| 1 | npm transport, its three production callers, four existing registry-mocked suites, transport regression tests, registry dependencies | Registry paths work without the native-capable npm HTTP stack |
| 2 | D1 store/inference cache integration, briefing route, old store plugin removal, D1 test harness, local Wrangler/Nitro config, local scripts and ignore rules | Existing briefing route backed only by real local D1, including safe failures |
| 3 | Read-only cache exporter and its regression tests | Existing successes can be imported without overwriting D1 winners or altering the source |
| 4 | Actual production-runtime smoke verification; narrowly scoped runtime fixes only if evidenced | Real application executes in local `workerd`, not just Nuxt dev |
| 5 | README/environment documentation and final validation | Reproducible supported workflow, accurate limitations, no obsolete local-store instructions |

Execution ownership refinement: Main owns all `package.json`, `nub.lock`, and `.gitignore` changes. The D1 owner owns the entire briefing-route test, including its registry fixture migration; the registry owner owns the other three registry-mocked suites. The exporter owner owns `vitest.config.ts` and consumes `openBriefingD1(persistPath) → { database, dispose }` from the D1 owner. These disjoint slices may run concurrently without shared-file edits. Main runs red/green checks only after the corresponding wave settles; agents skip all validation. Integration is reviewed before committing the coherent cutover. Task 4 consumes all preceding changes. Task 5 documents only verified commands/results.

### Created files

- `server/utils/npmRegistry.ts` — Effect HTTP JSON transport to the public npm registry.
- `server/utils/npmRegistry.unit.ts` — non-2xx/invalid JSON and encoded-query transport regressions.
- `migrations/0001_package_briefings.sql` — D1 success-table schema, unchanged column semantics.
- `wrangler.jsonc` — local-only binding configuration; Nitro generates the built entry/asset config.
- `test/helpers/briefingD1.ts` — actual Miniflare D1 harness, outside the application runtime graph.
- `scripts/export-briefings.ts` and `scripts/export-briefings.unit.ts` — explicit offline migration of the old SQLite data, using Node's built-in SQLite.
- `shared/cloudflare.d.ts` — ambient request-binding typing shared by Nuxt's server and typed-route consumer projects.
- `patches/effect@4.0.0-rc.115.patch` — native pending-Exit promise bridge for workerd request contexts.
- `server/utils/workerCache.unit.ts` and `test/fixtures/workerCache.ts` — deterministic real-workerd regression for the discovered shared-cache failure.

### Modified files

- `server/api/search/index.get.ts`
- `server/api/package/[packageName]/index.get.ts`
- `server/utils/packageComparisonFacts.ts`
- `server/utils/packageComparisonFacts.unit.ts`
- `server/api/package/[packageName]/compare/index.get.unit.ts`
- `server/api/package/[packageName]/compare/measurements.get.unit.ts`
- `server/api/package/[packageName]/compare/briefing.get.ts`
- `server/api/package/[packageName]/compare/briefing.get.unit.ts`
- `server/utils/packageBriefingStore.ts`, `server/utils/packageBriefingStore.unit.ts`
- `server/utils/packageBriefing.ts`, `server/utils/packageBriefing.unit.ts`
- `nuxt.config.ts`, `package.json`, `nub.lock`, `.gitignore`, `vitest.config.ts`
- `.env.example`, `README.md`

### Removed file

- `server/plugins/briefingStore.ts` — a process-local native client no longer exists to close.

Unchanged unless the real Worker smoke demonstrates a specific incompatibility: `packageTarball.ts`, `packageBriefingProvider.ts`, evidence packing, schemas, and app components/composables. No UI/endpoint redesign is hidden in Task 4.

## Task 1: Replace registry transport and migrate every caller

**Files:** `server/utils/npmRegistry.ts`, its new unit test, the search/package metadata routes, `packageComparisonFacts.ts`, the four registry-mocked test suites listed above, `package.json`, `nub.lock`.

**Consumes:** Existing Effect HTTP client/FetchHttpClient layer, existing registry schemas and error wrappers.

**Produces:** `getRegistryJson(path, options?)`, an Effect requiring `HttpClient.HttpClient`, returning unknown JSON. Callers still decode with their existing schemas. Search supports encoded query parameters; metadata preserves the install-v1 Accept header; version manifests preserve their existing URLs and no special Accept header.

- [x] **Step 1: Add behavioural transport regressions and observe them fail before introducing the helper.**

Start `server/utils/npmRegistry.unit.ts` with this complete core (use existing test import/order conventions):

```ts
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterEach, expect, it, vi } from 'vitest';
import { getRegistryJson } from './npmRegistry';

const run = (path: string, options?: Parameters<typeof getRegistryJson>[1]) =>
  Effect.runPromise(getRegistryJson(path, options).pipe(Effect.provide(FetchHttpClient.layer)));

afterEach(() => vi.unstubAllGlobals());

it('encodes search text without creating extra query parameters', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    expect(url.origin).toBe('https://registry.npmjs.org');
    expect(url.pathname).toBe('/-/v1/search');
    expect([...url.searchParams.keys()]).toEqual(['text', 'size']);
    expect(url.searchParams.get('text')).toBe('@scope/pkg & size=250');
    expect(url.searchParams.get('size')).toBe('20');
    return Response.json({ objects: [] });
  });
  await expect(run('/-/v1/search', { query: { text: '@scope/pkg & size=250', size: 20 } }))
    .resolves.toEqual({ objects: [] });
});

it('rejects an HTTP failure even when its body is valid JSON', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'rate limited' }, { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(run('/widget/1.0.0')).rejects.toBeDefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects a successful response with malformed JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{')));
  await expect(run('/widget/1.0.0')).rejects.toBeDefined();
});
```

Run `nub exec -- vitest run server/utils/npmRegistry.unit.ts`. The initial failure is the missing helper, not an external registry request.

- [x] **Step 2: Implement the transport using the existing `bundlephobia.ts` convention.**

```ts
import { Effect } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';

type RegistryJsonOptions = {
  query?: Readonly<Record<string, string | number>>;
  accept?: string;
};

export const getRegistryJson = Effect.fn('Registry.getJson')(function* (
  path: string,
  options: RegistryJsonOptions = {},
) {
  const url = new URL(`https://registry.npmjs.org${path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, String(value));
  }
  let request = HttpClientRequest.get(url.href);
  if (options.accept !== undefined) {
    request = HttpClientRequest.setHeader(request, 'accept', options.accept);
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.pipe(HttpClient.filterStatusOk).execute(request);
  return yield* response.json;
}, Effect.timeout('5 minutes'));
```

`path` is assembled internally, always beginning with `/`, with package/version segments URL-encoded by the caller. Never accept an arbitrary registry origin or URL from public input. Five minutes preserves the inspected npm client's timeout rather than adding an unrelated latency-policy change. No retry layer or npm CLI configuration/authentication support is added; the product uses the public registry. Document removal of implicit `.npmrc`/proxy-agent behaviour.

- [x] **Step 3: Cut over the three runtime import sites.**

In search, keep `EndpointQueryParamsSchema` and its schema decoding exactly as they are. Replace the Promise/npmFetch construction with:

```ts
const registryRequest = getRegistryJson('/-/v1/search', { query }).pipe(
  Effect.mapError(registryRequestError),
);
// At the existing execution boundary:
return Effect.runPromise(searchResults.pipe(Effect.provide(FetchHttpClient.layer)));
```

Import `FetchHttpClient` from `effect/unstable/http` and the helper from `../../utils/npmRegistry`.

In package metadata, retain the route shape and schema mapping. Read the raw router segment and explicitly decode it once, then encode it once for the registry URL. H3 2's `{ decode: true }` intentionally preserves encoded separators, so it is not sufficient for scoped package names:

```ts
const rawPackageName = getRouterParam(event, 'packageName');
if (!rawPackageName) throw createError({ statusCode: 400, statusMessage: 'Package name is required' });
const packageName = decodeURIComponent(rawPackageName);
const registryRequest = getRegistryJson(`/${encodeURIComponent(packageName)}`, {
  accept: REGISTRY_METADATA_ACCEPT,
}).pipe(Effect.mapError(registryRequestError));
return Effect.runPromise(packageMetadata.pipe(Effect.provide(FetchHttpClient.layer)));
```

Import the existing H3 `createError`, `FetchHttpClient`, and helper from `../../../utils/npmRegistry`. Validate a scoped package through the actual route in Task 4; do not double-encode `%2F`.

In `packageComparisonFacts.ts` replace only the request body and add service acquisition at cache lookup:

```ts
const registryVersionManifestRequest = (packageName: string, version: string) =>
  Effect.gen(function* () {
    const response = yield* getRegistryJson(
      `/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    );
    return yield* Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' });
  }).pipe(Effect.mapError(registryRequestError));

// Add inside the existing manifest Cache.makeWith options:
requireServicesAt: 'lookup',
```

Keep manifest cache capacity 128, exact-version success TTL five minutes, and tags/ranges/failures TTL zero. Its new HTTP requirement must come from the current request's layer, not be captured while the module constructs the cache.

- [x] **Step 4: Update existing registry-mocked suites at the real HTTP boundary.**

Remove `vi.mock('npm-registry-fetch', ...)` from these four suites, preserving their manifest fixtures and existing evidence/provider assertions:

1. `server/utils/packageComparisonFacts.unit.ts`
2. `server/api/package/[packageName]/compare/index.get.unit.ts`
3. `server/api/package/[packageName]/compare/measurements.get.unit.ts`
4. `server/api/package/[packageName]/compare/briefing.get.unit.ts`

Keep each suite's `registry.json` fixture resolver but invoke it from the global fetch stub. The manifests and tarballs share a host: a host-only interception would accidentally replace real tarball test fixtures with JSON. Use this boundary pattern:

```ts
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(new Request(input, init).url);
  if (url.origin === 'https://registry.npmjs.org' && !url.pathname.includes('/-/')) {
    return Response.json(await registry.json(url.pathname));
  }
  return fetchMock(input, init);
});
```

This pattern is for these manifest-only registry fixtures; the search helper regression owns `/-/v1/search`. Keep provider-call assertions scoped to the provider stub, not total network calls. Preserve release-note scheduling, no-AI declarations, measurement integrity, and sanitized briefing failure coverage.

- [x] **Step 5: Remove the native-capable registry dependencies and verify.**

```bash
nub remove npm-registry-fetch @types/npm-registry-fetch
nub exec -- vitest run server/utils/npmRegistry.unit.ts server/utils/packageComparisonFacts.unit.ts 'server/api/package/[packageName]/compare/index.get.unit.ts' 'server/api/package/[packageName]/compare/measurements.get.unit.ts' 'server/api/package/[packageName]/compare/briefing.get.unit.ts'
```

Search application source for remaining `npm-registry-fetch` references using the repository search tool. Historical plans may mention it; runtime code, current mocks, package dependencies, and active instructions must not. Commit after scoped review: `refactor: use Worker-compatible npm registry transport`.

## Task 2: Cut over briefing persistence and local runtime together

**Files:** D1 migration, Wrangler config, test harness, store/inference modules and tests, briefing route and tests, `nuxt.config.ts`, `package.json`, `nub.lock`, `.gitignore`; remove the native-store shutdown plugin.

**Consumes:** Current table/result schema; current evidence hash; Nitro 2 binding context; real local Miniflare D1.

**Produces:**

```ts
readStoredBriefing(database: D1Database, evidenceHash: string): Promise<AvailablePackageBriefing | undefined>
saveBriefing(database: D1Database, evidenceHash: string, briefing: AvailablePackageBriefing): Promise<AvailablePackageBriefing>
getPackageBriefing(input: BriefingInput, database: D1Database | undefined): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient>
```

`D1Database` is a type-only import from `@cloudflare/workers-types`. The route explicitly passes its request binding; absence is represented deliberately, not silently redirected to local SQLite.

- [x] **Step 1: Install pinned local-runtime tooling and introduce the authoritative schema.**

```bash
nub add -D wrangler@4.136.1 miniflare@5.20260921.0-alpha @cloudflare/workers-types@5.20260922.1
```

Write `migrations/0001_package_briefings.sql`:

```sql
CREATE TABLE IF NOT EXISTS package_briefings (
  evidence_hash TEXT PRIMARY KEY NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Schema installation is an explicit migration, not lazy DDL on each inference request. No job table or data expiration is added in M1.

Write `test/helpers/briefingD1.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

export async function openBriefingD1(persistPath: string) {
  const runtime = new Miniflare({
    workers: [{
      config: {
        name: 'briefing-harness',
        compatibilityDate: '2026-09-16',
        env: { BRIEFINGS_DB: { type: 'd1' } },
        manifest: {
          mainModule: 'harness.js',
          modules: {
            'harness.js': {
              type: 'esm',
              contents: 'export default { fetch() { return new Response("test harness"); } };',
            },
          },
        },
      },
    }],
    resourcePersistencePath: persistPath,
  });
  try {
    const database = await runtime.getD1Database('BRIEFINGS_DB');
    const schema = await readFile(new URL('../../migrations/0001_package_briefings.sql', import.meta.url), 'utf8');
    await database.prepare(schema).run();
    return { database, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
```

Create one isolated temporary directory/runtime per test lifecycle, or per suite with explicit row resets and module-cache isolation. The persistence regression must dispose/reopen the **same directory**, while independent tests must not share it. Do not import this helper into production files.

- [x] **Step 2: Replace the old SQLite-lock implementation test with result-preservation tests against D1.**

Retain the existing valid `briefing` fixture from `packageBriefingStore.unit.ts`. Delete the native `SQLITE_BUSY`/lock timing test; the D1 contract is first-success persistence, not one client's lock implementation. Replace its native setup/imports with:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openBriefingD1 } from '../../test/helpers/briefingD1';
import { readStoredBriefing, saveBriefing } from './packageBriefingStore';

let directory: string;
let store: Awaited<ReturnType<typeof openBriefingD1>> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'briefing-d1-'));
  store = await openBriefingD1(directory);
});
afterEach(async () => {
  await store?.dispose();
  store = undefined;
  await rm(directory, { recursive: true, force: true });
});
```

Inside each following test, first guard `if (store === undefined) throw new Error('D1 setup failed');` so TypeScript narrows the optional lifecycle value. The assertions defend observable persistence behaviour:

```ts
it('preserves one canonical success across competing writes', async () => {
  const alternative = { ...briefing, model: 'another-model' };
  const results = await Promise.all([
    saveBriefing(store.database, 'same-evidence', briefing),
    saveBriefing(store.database, 'same-evidence', alternative),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect([briefing, alternative]).toContainEqual(results[0]);
  expect(await readStoredBriefing(store.database, 'same-evidence')).toEqual(results[0]);
});

it('rejects a corrupt saved result instead of treating it as a miss', async () => {
  await store.database.prepare(
    'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?)',
  ).bind('corrupt-evidence', '{').run();
  await expect(readStoredBriefing(store.database, 'corrupt-evidence')).rejects.toBeDefined();
});

it('retains an old success when a later snapshot is saved', async () => {
  await saveBriefing(store.database, 'old-evidence', briefing);
  const changed = { ...briefing, model: 'changed-evidence-model' };
  await saveBriefing(store.database, 'new-evidence', changed);
  expect(await readStoredBriefing(store.database, 'old-evidence')).toEqual(briefing);
  expect(await readStoredBriefing(store.database, 'new-evidence')).toEqual(changed);
});
```

Run the targeted test before changing store implementation; the new explicit database API should fail against the old signatures.

- [x] **Step 3: Replace `packageBriefingStore.ts` with the D1 implementation.**

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { Schema } from 'effect';
import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../../shared/briefing.defs';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const SELECT_BRIEFING = 'SELECT response_json FROM package_briefings WHERE evidence_hash = ?';

function decodeRow(value: unknown): AvailablePackageBriefing {
  if (typeof value !== 'string') throw new Error('Stored briefing is not JSON text');
  return decodeBriefing(JSON.parse(value));
}

export async function readStoredBriefing(
  database: D1Database,
  evidenceHash: string,
): Promise<AvailablePackageBriefing | undefined> {
  const row = await database.prepare(SELECT_BRIEFING).bind(evidenceHash)
    .first<{ response_json: unknown }>();
  return row === null ? undefined : decodeRow(row.response_json);
}

export async function saveBriefing(
  database: D1Database,
  evidenceHash: string,
  briefing: AvailablePackageBriefing,
): Promise<AvailablePackageBriefing> {
  const validated = decodeBriefing(briefing);
  const [, selected] = await database.batch<{ response_json: unknown }>([
    database.prepare(
      'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?) ON CONFLICT (evidence_hash) DO NOTHING',
    ).bind(evidenceHash, JSON.stringify(validated)),
    database.prepare(SELECT_BRIEFING).bind(evidenceHash),
  ]);
  return decodeRow(selected?.results[0]?.response_json);
}
```

No custom `SQLITE_BUSY` retry loop, global database connection, environment file path, or shutdown API remains. Keep D1's normal primary behaviour; do not enable read replication in this milestone. The insert/select batch returns the canonical first success rather than the losing caller's freshly generated result.

- [x] **Step 4: Pass the database through the existing inference path without cross-binding cache leakage.**

Before changing exported symbols, use LSP references and migrate every caller. Keep `requestBriefing`, evidence packing, `briefingCacheIdentity`, `BriefingCacheKey`, timeout, and validation unchanged. Move only the existing `requestRecords`, `rememberRequest`, and `briefingCache` definitions into a database-scoped factory:

```ts
function createBriefingRuntime(database: D1Database) {
  const requestRecords = new Map<string, BriefingRequest>();
  const rememberRequest = (key: BriefingCacheKey, request: BriefingRequest): void => {
    const identity = briefingCacheIdentity(key);
    requestRecords.set(identity, request);
    if (requestRecords.size <= 512) return;
    const oldest = requestRecords.keys().next().value;
    if (oldest !== undefined) requestRecords.delete(oldest);
  };
  const cache = Effect.runSync(Cache.makeWith(
    (key: BriefingCacheKey) => {
      const request = requestRecords.get(briefingCacheIdentity(key));
      if (request === undefined) return Effect.succeed(unavailable('provider-error'));
      return requestBriefing(request).pipe(
        Effect.flatMap((briefing) => briefing.status === 'available'
          ? Effect.tryPromise<PackageBriefing>(() => saveBriefing(database, key.evidenceHash, briefing))
          : Effect.succeed(briefing)),
        Effect.catch(() => Effect.succeed(unavailable('cache-error'))),
      );
    },
    {
      capacity: 128,
      requireServicesAt: 'lookup',
      timeToLive: (exit) => Exit.isSuccess(exit) && exit.value.status === 'available'
        ? Duration.hours(1) : Duration.zero,
    },
  ));
  return { cache, rememberRequest };
}

const briefingRuntimes = new WeakMap<D1Database, ReturnType<typeof createBriefingRuntime>>();

function runtimeFor(database: D1Database) {
  let runtime = briefingRuntimes.get(database);
  if (runtime === undefined) {
    runtime = createBriefingRuntime(database);
    briefingRuntimes.set(database, runtime);
  }
  return runtime;
}
```

Apply these exact integration changes inside `getPackageBriefing`, preserving the rest of its current control flow:

```ts
export function getPackageBriefing(
  input: BriefingInput,
  database: D1Database | undefined,
): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient> {
  if (database === undefined) return Effect.succeed(unavailable('cache-error'));
  return Effect.gen(function* () {
    let evidence: BriefingEvidence;
    try {
      evidence = buildBriefingEvidence(input);
    } catch {
      return unavailable('invalid-response');
    }
    const evidenceHash = sha256(JSON.stringify(evidence));
    const stored = yield* Effect.tryPromise(() => readStoredBriefing(database, evidenceHash));
    if (stored !== undefined) return stored;

    const config = readBriefingConfig();
    if (config.status === 'not-configured') return unavailable('not-configured');
    if (config.status === 'invalid-config') return unavailable('invalid-config');
    const key = new BriefingCacheKey({
      evidenceHash,
      endpoint: config.value.endpoint,
      model: config.value.model,
      credentialIdentity: config.value.credentialIdentity,
      promptVersion: PROMPT_VERSION,
    });
    const runtime = runtimeFor(database);
    runtime.rememberRequest(key, {
      config: config.value,
      evidence,
      session: sha256(`${evidence.packageName}\n${evidence.from}\n${evidence.to}`),
    });
    return yield* Cache.get(runtime.cache, key);
  }).pipe(Effect.catch(() => Effect.succeed(unavailable('cache-error'))));
}
```

No provider call is moved before the persistent lookup. WeakMap scoping is necessary even when two bindings happen to use identical evidence/provider settings; D1 errors from one environment must not be hidden by another's in-memory cache.

At the route boundary:

```ts
const database: D1Database | undefined = event.context.cloudflare?.env?.BRIEFINGS_DB;
// In the existing facts -> briefing chain:
getPackageBriefing(facts, database)
```

Delete `server/plugins/briefingStore.ts` and all imports/usages of `closeBriefingStore`. Remove `@libsql/client` from `package.json`/`nub.lock` after its runtime and test callers have been migrated.

- [x] **Step 5: Migrate the existing inference/route tests to real local D1.**

In `packageBriefing.unit.ts` and `briefing.get.unit.ts`, replace `AI_BRIEFING_CACHE_PATH` and `closeStore` setup with `openBriefingD1(tempDirectory)`; retain module resets for process-local cache isolation. Open the runtime before stubbing HTTP or enabling fake timers. Unit helper callers explicitly supply `store.database`. Route test events supply:

```ts
event.context.cloudflare = { env: { BRIEFINGS_DB: store.database } };
```

Preserve existing tests for invalid-output retry, total deadline, citation rejection, oversized response, changed evidence, unchanged retrieval time, model/key rotation, and persisted reuse without provider configuration. For the module-reload persistence case, dispose Miniflare, reset the application modules, reopen the same directory, then clear provider settings and assert the same briefing returns with no additional provider request.

Replace the filesystem-open failure case with an actual D1 schema failure:

```ts
await store.database.exec('DROP TABLE package_briefings');
await expect(runBriefing(input())).resolves.toEqual({
  status: 'unavailable', reason: 'cache-error', bullets: [], sources: [],
});
expect(fetchMock).not.toHaveBeenCalled();
```

Add a missing-binding test using `getPackageBriefing(input(), undefined)` with a configured provider and the same no-fetch assertion. Add one cross-binding regression: generate/store using binding A; open a separate empty database B, drop B's table, invoke the identical input using B; expect `cache-error` and no extra provider request, never A's cached success. This guards a plausible environment-isolation bug.

For write failure, make the provider fixture drop `package_briefings` after its initial read but before returning valid output. Assert `cache-error`, not `available`; recreate the schema through the helper/migration for subsequent tests. Restore real timers before disposing Miniflare.

- [x] **Step 6: Configure genuine local bindings and production preview.**

Write binding-only `wrangler.jsonc` (the all-zero-style id is intentionally local-only, not a remote resource placeholder):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "can-i-update-local",
  "compatibility_date": "2026-09-16",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "BRIEFINGS_DB",
    "database_name": "can-i-update-local-briefings",
    "database_id": "00000000-0000-0000-0000-000000000001",
    "migrations_dir": "migrations",
    "remote": false
  }]
}
```

Do not add a remote account id, production routes, paid-provider secrets, Queues, or DO namespaces. No deployment script is added in M1.

Extend the existing `nitro` object in `nuxt.config.ts`, retaining its test exclusions:

```ts
nitro: {
  ignore: ['**/*.unit.ts'],
  preset: 'cloudflare_module',
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
    dev: { configPath: 'wrangler.jsonc', persistDir: '.wrangler/state/v3' },
  },
},
```

The existing top-level compatibility date remains `2026-09-16`. Installed Nitro 2.13.4 writes the built config to **`.output/server/wrangler.json`** and a `.wrangler/deploy/config.json` pointer; do not guess `.output/wrangler.json`. Its dev proxy uses `.wrangler/state/v3`; Wrangler CLI gets the parent `.wrangler/state` through `--persist-to`.

Add/replace these scripts, preserving unrelated scripts:

```json
{
  "db:migrate:local": "wrangler d1 migrations apply BRIEFINGS_DB --local --config wrangler.jsonc --persist-to .wrangler/state",
  "dev": "wrangler d1 migrations apply BRIEFINGS_DB --local --config wrangler.jsonc --persist-to .wrangler/state && nuxt dev --host 0.0.0.0 --port 5173",
  "build": "nuxt build",
  "preview": "wrangler dev --local --config .output/server/wrangler.json --persist-to .wrangler/state --ip 0.0.0.0 --port 5173"
}
```

Run dev and preview **sequentially**, not against the same state files at the same time. Root config owns migrations; generated config owns built assets/entrypoint. Ignore `.wrangler/`, `.dev.vars`, `.dev.vars.*`; retain the existing `.env.example` exception. Do not rely on Nitro's automatic ignore update.

Treat the dev proxy's empty-environment fallback as a failure for the briefing store: no binding means `cache-error`. Verify binding presence by exercising D1-backed briefing tests/smokes, not by the mere existence of the dev log banner.

- [x] **Step 7: Verify the coherent storage cutover before committing.**

```bash
nub exec -- vitest run server/utils/packageBriefingStore.unit.ts server/utils/packageBriefing.unit.ts 'server/api/package/[packageName]/compare/briefing.get.unit.ts'
nub run --node db:migrate:local
nub run --node dev
```

The final command is a supervised service; observe HTTP readiness and stop it after exercising the actual route with no real provider credentials. Verify that absent provider configuration still yields `not-configured` **when D1 is healthy**, and that missing binding/schema yields `cache-error`. No native libSQL import or shutdown plugin remains. Commit after scoped review: `feat: persist briefing snapshots in local D1`.

## Task 3: Preserve existing paid-for results with an explicit offline import

**Files:** `scripts/export-briefings.ts`, `scripts/export-briefings.unit.ts`, `vitest.config.ts`; README command details are finalized in Task 5.

**Consumes:** A user-selected existing SQLite file with the three current table columns; existing `AvailablePackageBriefingSchema`; D1 migration from Task 2.

**Produces:** An exclusively created SQL file containing validated, first-writer-wins inserts. No native library is reintroduced into the application. Import is an explicit local Wrangler command; remote import waits for M4's approved deployment configuration.

- [x] **Step 1: Add the migration regression before writing the exporter.**

Create a Node `DatabaseSync` fixture in a temporary source file using the exact schema. Insert one valid available briefing whose text contains an apostrophe, a newline, and non-ASCII text. Use a genuine 64-character lowercase SHA key. Close the fixture before spawning the exporter using `process.execPath` so the pinned Node runtime executes the `.ts` script.

Extend Vitest's existing include glob to `'{app,server,shared,scripts}/**/*.unit.ts'` without changing existing aliases/environment. The core regression must use the exported SQL, not a mocked writer:

```ts
const result = spawnSync(process.execPath, [
  'scripts/export-briefings.ts', sourcePath, exportPath,
], { encoding: 'utf8' });
expect(result.status).toBe(0);
const sql = await readFile(exportPath, 'utf8');
await target.database.prepare(sql).run();
expect(await readStoredBriefing(target.database, evidenceHash)).toEqual(original);
// Importing again or importing over an existing result cannot replace the winner.
await target.database.prepare(sql).run();
expect(await readStoredBriefing(target.database, evidenceHash)).toEqual(original);
```

Seed a second target with a different valid winner under the same hash, execute the SQL, and assert that winner survives. Independently hash the source file before/after export to prove no source mutation. Add malformed-row and pre-existing-output tests: nonzero exit, no replacement of the user's output file, no importable partial output. Keep SQL-escaping and invalid-row cases because a bug here can lose paid-for results.

Run `nub exec -- vitest run scripts/export-briefings.unit.ts` and observe the missing exporter failure.

- [x] **Step 2: Implement the complete offline exporter.**

```ts
import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { AvailablePackageBriefingSchema } from '../shared/briefing.defs.ts';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node scripts/export-briefings.ts SOURCE.sqlite OUTPUT.sql');
const source = resolve(sourceArg);
const output = resolve(outputArg);
if (source === output || existsSync(output)) throw new Error('Output must be a new file, different from source');
const temporary = `${output}.${process.pid}.${createHash('sha256').update(source).digest('hex').slice(0, 8)}.tmp`;
const database = new DatabaseSync(source, { readOnly: true });
const validate = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
let descriptor: number | undefined;
let temporaryCreated = false;
let count = 0;
try {
  database.exec('BEGIN');
  descriptor = openSync(temporary, 'wx', 0o600);
  temporaryCreated = true;
  for (const row of database.prepare(
    'SELECT evidence_hash, response_json, created_at FROM package_briefings ORDER BY evidence_hash',
  ).iterate()) {
    const hash = row.evidence_hash;
    const response = row.response_json;
    const createdAt = row.created_at;
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)
      || typeof response !== 'string' || typeof createdAt !== 'string') {
      throw new Error('Invalid stored briefing row');
    }
    validate(JSON.parse(response));
    // JSON text is escaped, not decoded/re-encoded: preserve the stored paid-for response verbatim.
    writeFileSync(descriptor,
      `INSERT INTO package_briefings (evidence_hash, response_json, created_at) VALUES (${literal(hash)}, ${literal(response)}, ${literal(createdAt)}) ON CONFLICT (evidence_hash) DO NOTHING;\n`,
    );
    count++;
  }
  database.exec('COMMIT');
  closeSync(descriptor);
  descriptor = undefined;
  // Hard-link publication is atomic and fails if the output already exists; rename could overwrite it.
  linkSync(temporary, output);
  unlinkSync(temporary);
  temporaryCreated = false;
  console.log(`Exported ${count} validated briefing snapshots to ${output}`);
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  database.close();
  if (temporaryCreated) unlinkSync(temporary);
}
```

The script is operational/offline only. It may read native SQLite using Node 26 but must never be imported into `server/`, `shared/`, or the Worker entry. Keep the source file after successful import. If the source contains invalid rows, stop and report them; do not drop them silently or generate replacement briefings.

- [x] **Step 3: Exercise the export/import using fixture data, then document user-data migration as an explicit action.**

```bash
nub exec -- vitest run scripts/export-briefings.unit.ts
# For a deliberately selected real source, after backing it up:
node scripts/export-briefings.ts .data/briefings.db .data/briefings-export.sql
nub run --node db:migrate:local
nub exec -- wrangler d1 execute BRIEFINGS_DB --local --config wrangler.jsonc --persist-to .wrangler/state --file .data/briefings-export.sql
```

The live-data commands are instructions, not automatic operations during this task. Verify imported row counts and at least one decoded result before changing which environment users access. Never use a migration that drops the old file or overwrites existing D1 rows. Commit after scoped review: `feat: export existing briefing snapshots for D1 import`.

## Task 4: Prove the actual app under the production runtime

**Files:** No permanent smoke scaffold. Use this plan and temporary files under the plan's git-ignored execution workspace. Only evidence-backed fixes in the owning modules are allowed; record them and request review rather than hiding incompatibility with stubs.

**Consumes:** Tasks 1–3, built app, root/generated Wrangler configs, schema, a local-only OpenAI-compatible fixture endpoint.

**Produces:** Recorded command/output/browser evidence for all rows of the acceptance matrix below. A native-module failure, empty D1 binding, broken tarball path, or dev-server disconnect crash fails this task.

- [x] **Step 1: Create an isolated verification environment and deterministic provider fixture.**

Do not load the developer's real AI key. Use a temporary workspace/state directory, and a temporary `.dev.vars` associated with the config used for preview containing exactly:

```dotenv
AI_BRIEFING_ENDPOINT=http://127.0.0.1:9091/v1/chat/completions
AI_BRIEFING_API_KEY=local-fixture-only
AI_BRIEFING_MODEL=local-fixture
```

The existing endpoint validator permits loopback HTTP; do not relax it for this smoke. Keep this file and the local endpoint out of deployment configuration. Registry/OSV/GitHub/Bundlephobia calls are real public-data requests in this smoke; failures must retain their existing honest partial/unavailable semantics. Unit tests remain entirely network-stubbed.

A throwaway Node provider process can use this complete code:

```js
import { createServer } from 'node:http';
let calls = 0;
const requests = [];
createServer(async (req, res) => {
  if (req.url === '/calls') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ calls, requests }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  calls++;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    id: 'local-fixture', object: 'chat.completion', created: 1700000000,
    model: 'local-fixture',
    choices: [{ index: 0, finish_reason: 'stop', message: {
      role: 'assistant',
      content: JSON.stringify({ bullets: [{
        kind: 'migration', basis: 'fact',
        text: 'Local verification fixture: review the published Node engine declarations.',
        evidenceIds: ['comparison.node'],
      }] }),
    } }],
  }));
}).listen(9091, '127.0.0.1');
```

This is a clearly labelled test double for the external paid provider only. D1, request routing, evidence collection, hashing, provider client/envelope decoding, output validation, and persistence are the real application implementations. Never describe it as successful real-model inference.

Use supervised processes with observed readiness. Do not add `/debug`, reset-database, arbitrary-proxy, or fixture routes to the application.

- [x] **Step 2: Run the development acceptance matrix.**

Start `nub run --node dev` with the local-only fixture settings and isolated D1 state. Observe readiness at `http://127.0.0.1:5173/api/health`. Exercise:

| Request/surface | Required observation |
| --- | --- |
| `/api/search?text=minimist&size=5` | Decoded search response, no native npm client |
| `/api/package/%40vue%2Fshared` | Scoped metadata works; no `%252F` double encoding |
| `/api/package/minimist/compare?from=1.2.5&to=1.2.8` | Resolved declarations, no AI call |
| Same pair `/compare/measurements` | Real measurement path runs; tarball summaries correspond to actual successful inspection when registry artifacts are available |
| Same pair `/compare/briefing` | Validated `available` fixture result is written to D1 |
| Repeat exact evidence | Same stored result; fixture `/calls` does not increase |
| Missing binding/schema | Sanitized `cache-error`; fixture call count does not increase |
| `/minimist/1.2.5...1.2.8` browser | SSR declarations/hydration and independent measurements/briefing; no new console errors |
| Existing component template edit | HMR updates visible text without changing document time origin or losing a window sentinel; restore edit |
| Repeated navigation/tab close/reopen | Server remains listening; exercise at least ten cycles and inspect errors |

Do not compare only a 200 status or nonempty JSON. Check the existing response schemas and visible row states. If the spike's `ECONNRESET` instability recurs without the throwaway WebSocket bridge, diagnose it before calling local DX ready.

- [x] **Step 3: Build and boot the exact production artifact.**

Stop development before opening the same local D1 state with another runtime. Run:

```bash
nub run --node build
nub run --node db:migrate:local
nub run --node preview
```

Observe successful `workerd` startup and actual health response. Repeat the matrix's search/scoped metadata/declarations/measurements/briefing/browser rows against this server. Neither `kerberos` nor native `libsql` may appear as unresolved imports/startup dependencies. Record Nuxt/Nitro/Wrangler versions and the active compatibility date with the evidence.

Inspect the real tarball path: crypto digests/timing-safe comparison, gzip decompression, Node streams and `tar-stream` are not proven by root-page success. An unavailable tarball caused by a runtime incompatibility fails the milestone; it cannot be accepted as ordinary upstream unavailability. Keep all existing integrity/path/size bounds if a supported API adjustment is needed.

- [x] **Step 4: Prove cross-runtime persistence without relying on changed upstream evidence.**

Use a stable, exact-version input and retain the fixture provider's recorded request/evidence hash. First confirm the same evidence SHA in dev and production preview, then verify reuse. If public upstream evidence changes between runs, do not mislabel valid regeneration as cache loss: compare the SHA and use the existing deterministic D1/inference regressions to prove the immutable-snapshot contract.

Stop/restart Wrangler using the same config and `--persist-to` directory. Verify the recorded D1 row and decoded result survive. Disable all three provider settings, restart, and read the already-generated snapshot through `getPackageBriefing` with the same evidence in the deterministic harness; assert it returns without provider access. The existing unit test for that contract remains the deterministic proof when live evidence drifts.

For an HTTP-level read-failure smoke, use an isolated verification database, drop its briefing table, invoke the real briefing route with the fixture configured, and confirm `cache-error` plus an unchanged fixture call counter. Reapply the migration afterwards. Never run this fault against the developer's imported data.

- [x] **Step 5: Record the runtime verdict and remove only temporary verification material.**

Record exact commands, readiness, responses, browser HMR evidence, D1 persistence proof, and any remaining discrepancy in the execution ledger. Remove the temporary provider/settings/state after collecting evidence; leave real developer data alone. Do not create a permanent smoke test just to inflate coverage. A discovered uncertain edge case earns a regression in the relevant existing suite.

If a new native/platform blocker requires a new design decision, record the failure and revise the plan/spec explicitly. Do not mark the task complete, downgrade its gate to a fixture Worker, or ship an `unavailable` fallback for functionality that used to work.

No public deployment occurs here. The remote transport spike already passed, but it is not evidence that this changed application is deployed.

## Task 5: Document the verified workflow and perform integration review

**Files:** `README.md`, `.env.example`; current spec/plan execution status only if implementation actually passed. No changelog file exists, so do not introduce one solely for this migration.

**Consumes:** Passing local-runtime evidence and the real commands from Tasks 1–4.

**Produces:** Accurate developer/migration instructions and a coherent, reviewed milestone with no obsolete store/dependency path.

- [x] **Step 1: Update current documentation and environment examples.**

Replace the README's local-libSQL persistence paragraphs and Node production-preview instructions with these facts:

- D1 `BRIEFINGS_DB` is required for briefing persistence; successful evidence snapshots are permanent and first-writer-wins.
- `nub run --node dev` applies local migrations and runs Nuxt HMR with emulated bindings. Local bindings require no Cloudflare account.
- `nub run --node build`, `nub run --node db:migrate:local`, then `nub run --node preview` run the real built Worker locally.
- Dev proxy path `.wrangler/state/v3` and Wrangler `--persist-to .wrangler/state` refer to the same state; do not run two owners concurrently against that directory.
- `.env` is used by normal Nuxt development; `.dev.vars` is used by Wrangler. Keep the same intentional server-only settings in the appropriate local file; neither file is committed. Fixture verification must never inherit real credentials.
- Remove `AI_BRIEFING_CACHE_PATH` from active instructions and `.env.example`; explain the explicit exporter for any old custom-path source.
- Document Task 3's source-preserving export, local migration, and import commands; import does not overwrite an existing success.
- Explain that npm now uses the public HTTPS registry, not npm CLI proxy/auth configuration.
- The GET briefing endpoint is still synchronous in M1. D1 alone does not prevent cross-instance duplicate inference. Queueing, global budgets, and push notifications are subsequent milestones; do not claim they are implemented.
- The local-only Wrangler config cannot be used as the production deployment config. Production resource creation and launch remain M4.

Do not edit old historical plans merely because they describe the old implementation; current README/example/config are the active cutover surface.

- [x] **Step 2: Run integration validation once, after all code edits and task-scoped reviews.**

```bash
nub run --node test
nub run --node type-check
nub run --node lint:check
nub run --node format:check
nub run --node build
```

Run formatting only if needed, then repeat affected checks. If commit hooks already ran identical validation on the same tree, reuse the recorded output instead of launching duplicate suites. Reboot the produced Worker and exercise health plus an affected route after any build-affecting fix; an earlier good build is not verification of a changed final tree.

Use repository search to verify no runtime `npm-registry-fetch`, `@libsql/client`, `closeBriefingStore`, or `AI_BRIEFING_CACHE_PATH` references remain. `node:sqlite` is allowed only in the offline exporter/test graph. No provider key or `.dev.vars` content appears in the diff.

- [x] **Step 3: Complete task review and whole-milestone review.**

Review against spec §§3 and 11: hash unchanged, first paid success preserved, missing storage fails closed, every caller migrated, old plugin/dependencies removed, real local runtime exercised, and no accidental queue/UI/production-rollout scope. Include the tarball and cross-runtime state evidence. Commit documentation with a conventional message and finish the development branch only after the final review resolves load-bearing findings.

## Acceptance checklist

- [x] Public registry search, scoped metadata, and exact/tag comparison resolution work without `npm-registry-fetch`.
- [x] Existing successful results can be exported/imported without loss or overwrite.
- [x] D1 is the sole application store; malformed/missing/broken storage cannot cause new inference.
- [x] Evidence-hash, model/key/prompt non-invalidation, indefinite reuse, and timestamp exclusion remain covered.
- [x] Existing provider output/retry/deadline/citation tests retain their behaviour.
- [x] Nuxt HMR remains usable; repeat navigation/disconnect does not leave a dead listener.
- [x] Actual Cloudflare build boots; search, SSR, measurements/tarballs, and briefing persistence/provider path execute in local `workerd`.
- [x] Dev and preview use the intended same local D1 state and do not reset it on ordinary restart.
- [x] No public deployment, remote bindings, paid AI calls, or queue/client feature is introduced by this milestone.

## Author self-review and execution handoff

| Shared surface | Producer → consumer | Consistency check |
| --- | --- | --- |
| Registry helper | Task 1 helper → search, metadata, comparison facts | All callers provide FetchHttpClient; manifest cache acquires it at lookup |
| Dependencies | Task 1 removals → Task 2 tooling/removal → Task 5 final build | Serialize package/lockfile changes; no unenv/native alias remains |
| D1 schema | Task 2 migration → test helper, Task 3 exporter, Task 4 runtime | Same three columns; immutable SHA primary key; conflict never overwrites |
| Store API | Task 2 explicit database argument → inference and route tests | All callers migrate; missing binding intentionally maps to cache-error |
| Cache scope | Task 2 binding-local runtime → multi-binding regression | No module-global mutable database and no cross-environment result reuse |
| Local paths | Task 2 Nitro/CLI config → Task 4 restart/cross-runtime smoke | Dev v3 directory versus CLI parent directory is explicit and must be exercised |
| Existing data | Task 3 read-only export → local D1 import | Source retained; schema decoder accepts legacy valid stored responses |
| Public contract | Spec M1 → Tasks 1–5 | GET shape unchanged; no M2/M3 endpoint states silently introduced |
| Runtime claims | Task 4 observations → Task 5 docs | Build, boot, real API behaviour and HMR are separate acceptance observations |

Task self-consistency: Task 1 changes transport but not registry schema/caches; Task 2 changes store and its binding/callers together; Task 3 is offline-only and cannot reintroduce native runtime imports; Task 4 explicitly distinguishes fixture-provider coverage from real inference; Task 5 documents only demonstrated results.

M1 execution is complete. Scoped DeepSeek V4.1 implementation and independent reviews used a per-plan execution ledger. Final verification passed 198 tests, type checking, lint (zero errors; nine style warnings), formatting, and the Cloudflare build. The final artifact booted and served health, scoped metadata, real tarballs, and a stored briefing without provider settings. HMR retained document identity and ten navigation/disconnect cycles passed. Owned fixture services, credentials, source/export fixtures, and local D1 state were removed; original developer data was not migrated or modified. Observed NUXT_E8001/E8002 experimental SSR-streaming warnings remain visible and were not suppressed. M2/M3/M4 implementation and deployment remain outside this milestone.
