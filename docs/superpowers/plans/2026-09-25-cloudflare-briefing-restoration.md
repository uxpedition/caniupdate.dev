# Cloudflare Briefing Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore asynchronous, evidence-linked AI briefings on Cloudflare Workers Free with one active generation per evidence snapshot, D1 reuse, and hibernating WebSocket completion.

**Architecture:** The Nuxt Worker obtains bounded evidence from the existing private package-evidence Durable Object and privately submits the exact packet to a new briefing Worker. One SQLite-backed job Durable Object per evidence hash owns generation, D1 reconciliation, and subscriber notifications; a Cloudflare Queue only wakes that object. A separate public `workers.dev` hostname serves read-only WebSocket upgrades; the page keeps fetching factual comparisons independently.

**Tech Stack:** Nuxt 4, H3 2, Effect 4 RC and its OpenAI-compatible client, TypeScript, Cloudflare Workers/Queues/SQLite-backed Durable Objects/D1, Vue Query, Vitest, Wrangler, Nub.

**Spec:** `docs/superpowers/specs/2026-09-25-cloudflare-briefing-restoration-design.md`

## Global Constraints

- Workers Free only. Ordinary Worker and Queue-consumer invocations must be measured against 10 ms CPU; SQLite-backed Durable Object requests have a 30-second CPU allowance. No Cloudflare upgrade or deployment without separate approval.
- Reuse the existing private `PACKAGE_EVIDENCE` object, 48 KiB / 64-source packet limits, evidence validation, prompt, citation rules, 75-second total provider deadline, and one invalid-output retry. No browser-supplied evidence or hash.
- D1 `package_briefings` remains first-writer-wins, permanent, keyed by SHA-256 of `JSON.stringify` of the decoded model-visible packet. D1 read failure prevents a new provider call; write failure is never reported as durable success.
- No application daily attempt cap. The OpenRouter key's configured budget is the spend boundary; no real key in tests, logs, checked-in files, or default preview. Socket reads/reconnects must never start inference.
- An invalid output may be regenerated once within the same 75-second deadline. No automatic new paid attempt after an ambiguous crash, transport failure, or two invalid outputs; only a subsequent POST can start a new generation. Failures are not D1 successes.
- Existing factual routes and UI remain independent of inference. No sync GET fallback, browser polling, SSE, local archive fallback, legacy aliases, or paid-tier assumption.
- The working tree currently contains a user-owned deletion of `test/helpers/briefingD1.ts`. Do not restore, stage, or work around that deletion without user direction. Existing lint/type/tests importing it are known to fail; document this as a validation blocker until independently resolved. New job tests should be isolated from that deleted helper.
- An untracked user-owned `scripts/dev.effect.ts` appeared during planning. The current package script still runs `scripts/dev.ts`; do not edit or discard the new file. Recheck the active launcher before Task 5 in case the user's concurrent work changes that entrypoint.

## File Structure and Interfaces

| File | Responsibility |
| --- | --- |
| `shared/briefingJob.defs.ts` (new) | Typed POST result and socket snapshot union, hash and URL bounds, no provider secret/packet in public types. |
| `server/utils/packageBriefing.ts` (modify) | Extract current provider generation into an explicit-target function; preserve output validation and retry. |
| `server/utils/packageBriefingStore.ts` (reuse) | The current D1 read and first-writer-wins save; do not rewrite the table or key. |
| `workers/briefing/job.ts` (new) | Per-hash SQLite DO: immutable pending packet, dispatch/recovery, provider execution, D1 reconciliation, socket subscribers. |
| `workers/briefing/index.ts` (new) | Private submission entry, Queue consumer, public read-only upgrade; reject public writes. |
| `workers/briefing/wrangler.jsonc`, `workers/briefing/tsconfig.json` (new) | Local and isolated preview bindings, Queue producer/consumer, DO migration, D1, no default public endpoint. |
| `server/api/package/[packageName]/compare/briefing.post.ts` (new) | Validate existing route params, request bounded evidence, call private briefing service, return 200/202 or sanitized 503. |
| `server/api/package/[packageName]/compare/briefing.get.ts` (remove at cutover) | Obsolete synchronous generation path. |
| `app/composables/packageBriefingQueryOptions.ts`, `app/composables/useComparisonPage.ts` (modify) | Client-only submission, socket lifecycle, Vue Query completion/citations, abort on comparison change. |
| `shared/cloudflare.d.ts`, `wrangler.jsonc`, `scripts/dev.ts`, `package.json`, `nuxt.config.ts` (modify as applicable) | Private service binding and three-Worker local/built runtime; migrate D1 ownership without deleting local data. |
| `README.md`, `.env.example`, `docs/cloudflare-handoff.md` (modify after runtime proof) | Updated keys, new endpoint/state contract, local commands, Free rollout gates. |

The browser protocol is deliberately small:

```ts
import type { AvailablePackageBriefing, BriefingUnavailableReason } from './briefing.defs';

export type BriefingSubmission =
  | { status: 'available'; packageName: string; from: string; to: string; briefing: AvailablePackageBriefing }
  | { status: 'queued' | 'running'; packageName: string; from: string; to: string; hash: string; eventsUrl: string; revision: number };
export type BriefingJobEvent =
  | { status: 'queued' | 'running'; revision: number }
  | { status: 'available'; revision: number; briefing: AvailablePackageBriefing }
  | { status: 'unavailable'; revision: number; reason: BriefingUnavailableReason };
export declare function decodeBriefingJobEvent(value: unknown): BriefingJobEvent;
```

## Task 1: Preserve the existing evidence identity and provider behavior

**Files:** Modify `server/utils/packageBriefing.ts`; create `server/utils/packageBriefingGeneration.unit.ts`, `shared/briefingJob.defs.ts`, `shared/briefingJob.defs.unit.ts`. Existing `packageBriefing.unit.ts` remains for final regression verification once its user-deleted helper is resolved.

**Interfaces:** Consumes `BriefingEvidence`, `BriefingProviderTarget`, `AvailablePackageBriefing`. Produces `briefingEvidenceHash(evidence: BriefingEvidence): string`, `readBriefingConfig(env: { AI_BRIEFING_ENDPOINT?: string; AI_BRIEFING_API_KEY?: string; AI_BRIEFING_MODEL?: string }): BriefingConfig`, and `generateBriefing(evidence: BriefingEvidence, target: BriefingProviderTarget): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient>`. Export the existing `BriefingConfig` discriminated union for the job Worker. Existing synchronous caller temporarily remains until Task 4 removes it; no second provider implementation is added.

- [ ] **Step 1: Add red behavioral tests.** A fixed decoded evidence fixture must hash to the same 64-character lowercase SHA-256 as the current `createHash('sha256').update(JSON.stringify(evidence), 'utf8').digest('hex')`; a fixture provider must produce an available cited briefing, retry once on invalid output, and make no second request on HTTP failure. Add a contract test decoding the exact 200, 202, and terminal socket envelopes; reject a packet or credential in a public envelope. For example:

```ts
const evidence = { packageName: 'minimist', from: '1.2.0', to: '1.2.8', sources: [], gaps: [] };
expect(briefingEvidenceHash(evidence)).toBe('b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4');
expect(decodeBriefingJobEvent({ status: 'unavailable', revision: 2, reason: 'invalid-response' })).toEqual({
  status: 'unavailable', revision: 2, reason: 'invalid-response',
});
```

- [ ] **Step 2: Run only these focused tests, recording the expected failure before changing production code.** `nub x --node vitest run shared/briefingJob.defs.unit.ts server/utils/packageBriefingGeneration.unit.ts`. These new tests use a fixture provider without the user-deleted D1 helper; do not rerun the already-known missing-helper checks until the unrelated deletion is independently resolved.
- [ ] **Step 3: Extract the existing implementation without changing prompt, validation, deadline, or retry semantics.** Validate/schema-decode before hashing; export the hash helper rather than recomputing it differently in the job. Pass explicit target into provider generation; use Cloudflare secret bindings at the new service boundary instead of reading `process.env` from a background invocation. Keep config parsing as a separate pure boundary so all-three-missing and partial settings still map to existing sanitized reasons.

```ts
export const briefingEvidenceHash = (value: BriefingEvidence): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
export const generateBriefing = (evidence: BriefingEvidence, target: BriefingProviderTarget) =>
  requestBriefing({ config: target, evidence, session: sha256(`${evidence.packageName}\n${evidence.from}\n${evidence.to}`) });
```

- [ ] **Step 4: Re-run the focused tests; review old D1-key test fixtures for accidental hash changes.** Commit this independently testable provider/contract extraction only after it passes; never stage the deleted helper.

## Task 2: Implement one durable job per evidence hash

**Files:** Create `workers/briefing/job.ts`, `workers/briefing/index.ts`, `workers/briefing/wrangler.jsonc`, `workers/briefing/tsconfig.json`, `workers/briefing/job.unit.ts`; modify `package.json` build/type-check scripts as needed. Reuse `workers/evidence/cloudflare.d.ts` for the standalone project and `server/utils/packageBriefingStore.ts` for D1.

**Interfaces:** Consumes `briefingEvidenceHash`, `generateBriefing`, `readStoredBriefing`, `saveBriefing`, and `BriefingEvidenceSchema`. Export a named `BriefingSubmitter extends WorkerEntrypoint` with `submit(packet: BriefingEvidence): Promise<BriefingSubmission>` and bind Nuxt to that named entrypoint using `services[].entrypoint: 'BriefingSubmitter'`. The default Worker export owns public `fetch` and Queue `queue` handlers; `fetch` rejects submission. Persist `JobRecord` with `hash: string`, `generationId: number`, `revision: number`, `state: 'queued' | 'running' | 'available' | 'unavailable'`, `dispatchAttempts: number`, `packet?: BriefingEvidence` (present only while pending), `leaseUntil?: number`, `fence?: number`, and `reason?: BriefingUnavailableReason`; additionally expose `reconciledSnapshot(): Promise<BriefingJobEvent>` for reconnect and recovery. The job DO implements `run(message: { hash: string; generationId: number }): Promise<BriefingJobEvent>`; its private `commitAvailable(value: AvailablePackageBriefing)`, `commitUnavailable(reason: BriefingUnavailableReason)`, `claimRunning(generationId: number, expiresAt: number)`, and `commitIfCurrent(lease: number, result: PackageBriefing)` methods persist transitions and each return `Promise<BriefingJobEvent>` (except `claimRunning`, which returns `Promise<number>` fencing token). Task 3 attaches subscribers to the same object. Cloudflare's [named-entrypoint binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/#named-entrypoints) keeps public GET and private submission separate.

**Revision (2026-09-26, after this plan was implemented):** the submission entrypoint answers JSON text (`submit(packet): Promise<string>`), not a `BriefingSubmission` object, because workerd attaches an own `Symbol.dispose` to every object it deserializes for a caller, and the route's strict decode rejects undeclared own keys of any kind — relaxing it would drop the deliberate excess-property guard. The Nuxt route parses that text and hands it to `decodeBriefingSubmission` before trusting it, and `workers/briefing/job.unit.ts` pins the wire contract at a real `BRIEFING_SERVICE` binding.

- [ ] **Step 1: Write red integration tests against the actual DO/D1/Queue fixture.** Use an isolated temporary Wrangler/Miniflare state directory rather than the deleted repo test helper. Check: cold submit yields one queued job; two simultaneous same-hash submits send one queue message and ultimately yield one provider call; warm submit returns the persisted first-writer result without provider config; changed evidence gets a new hash. Crash/fault tests cover failed D1 read (zero provider calls), duplicate delivery while running, outage before Queue acceptance, D1 persisted before state commit, two invalid model outputs (two calls, unavailable, no D1 row), provider HTTP failure (one call), and explicit later POST starting a fresh generation. Tests assert result transitions and request counts, not mocks echoing their inputs. The test fixture exposes `submit(evidence: BriefingEvidence)`, `waitForStoredBriefing(database: D1Database, hash: string): Promise<AvailablePackageBriefing>` (a bounded condition wait), `database: D1Database`, and a numeric `providerRequests` counter; the real local Queue delivers messages, not a mock handoff.

```ts
const [first, second] = await Promise.all([submit(evidence), submit(evidence)]);
expect(first.status).toMatch(/queued|running/);
expect(second.status).toMatch(/queued|running/);
const stored = await waitForStoredBriefing(database, briefingEvidenceHash(evidence));
expect(stored).toMatchObject({ status: 'available', model: 'test-model' });
expect(providerRequests).toBe(1);
```

- [ ] **Step 2: Run `nub x --node vitest run workers/briefing/job.unit.ts`; confirm cold/race/recovery cases fail before implementation.** This test creates its own temporary state and fake OpenAI-compatible endpoint; no paid credentials.
- [ ] **Step 3: Implement the SQLite job state and Queue handoff.** Schema-decode the packet, recompute its hash inside the job DO, and reject a mismatch with its addressed object ID. Store the bounded immutable packet and generation ID before acknowledging 202; set an alarm before attempting Queue send so failed sends can recover. The producer sends only hash/generation ID. The consumer looks up the DO, awaits `run`, and acknowledges a committed result or already-owned generation. Duplicate deliveries and old generations do not regenerate. On `run`, read D1 first, then mark `running` with a lease/fencing token, use the existing 75-second provider pipeline, save/read back D1, commit a monotonically revised terminal event, and discard the saved packet. On crash, the alarm reconciles D1; an expired running generation without D1 becomes unavailable, **not** a new paid call. Check configuration only after the D1 lookup; missing or partial configuration returns the existing sanitized unavailable reason without queuing, while a D1 hit stays available. Queue/dispatch failures become terminal after three dispatch attempts and a Queue consumer `max_retries` of two rather than perpetually queued. Use a 90-second lease (75-second provider deadline plus 15-second persistence margin) and a 30-second dispatch-recovery alarm; prove these are safe with delayed fixture responses before relying on them.

```ts
// Inside BriefingJob.run; only a new submission increments generationId after failure.
const job = await this.ctx.storage.get<JobRecord>('job');
if (job === undefined || job.generationId !== message.generationId || job.state !== 'queued') {
  return await this.reconciledSnapshot();
}
const stored = await readStoredBriefing(this.env.BRIEFINGS_DB, message.hash);
if (stored !== undefined) return await this.commitAvailable(stored);
if (job.packet === undefined) return await this.commitUnavailable('cache-error');
const config = readBriefingConfig(this.env);
if (config.status !== 'configured') return await this.commitUnavailable(config.status);
const lease = await this.claimRunning(message.generationId, Date.now() + 90_000);
const generated = await Effect.runPromise(generateBriefing(job.packet, config.value).pipe(
  Effect.provide(FetchHttpClient.layer),
));
return await this.commitIfCurrent(lease, generated);
```

- [ ] **Step 4: Configure the local-only default and isolated preview bindings.** Briefing Worker default has `workers_dev: false`, SQLite `BriefingJob` migration, Queue producer/consumer, and D1 binding. Preview name is `can-i-update-preview-briefing`, `workers_dev: true` for the read-only socket, with preview D1 ID `351da802-5296-4e6a-a186-f9d1e99036b6`; never deploy default placeholder IDs. Set `BRIEFING_PUBLIC_URL` to `wss://can-i-update-preview-briefing.caniupdate-dev.workers.dev` under `env.preview` and to `ws://localhost:8791` locally, so the service returns the correct socket URL without taking one from the browser. Backend `AI_BRIEFING_API_KEY` is a secret; local fixture variables live only in `workers/briefing/.dev.vars`. Run `nub x --node wrangler deploy --dry-run --config workers/briefing/wrangler.jsonc --env=` and focused tests. Commit after actual local Worker generation/D1 reuse is observed, not just type checking. The local config uses these concrete names; preview repeats all non-inheritable bindings (`durable_objects`, `queues`, `d1_databases`, `vars`) with preview names/IDs rather than inheriting local bindings:

```jsonc
{
  "name": "can-i-update-local-briefing",
  "main": "index.ts",
  "compatibility_date": "2026-09-16",
  "compatibility_flags": ["nodejs_compat", "no_nodejs_compat_v2"],
  "workers_dev": false,
  "durable_objects": { "bindings": [{ "name": "BRIEFING_JOBS", "class_name": "BriefingJob" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BriefingJob"] }],
  "queues": {
    "producers": [{ "binding": "BRIEFING_QUEUE", "queue": "can-i-update-local-briefings" }],
    "consumers": [{ "queue": "can-i-update-local-briefings", "max_batch_size": 1, "max_batch_timeout": 0, "max_retries": 2 }]
  },
  "d1_databases": [{ "binding": "BRIEFINGS_DB", "database_name": "can-i-update-local-briefings", "database_id": "00000000-0000-0000-0000-000000000001", "migrations_dir": "../../migrations", "remote": false }],
  "vars": { "BRIEFING_PUBLIC_URL": "ws://localhost:8791", "BRIEFING_ALLOWED_ORIGIN": "http://localhost:5173" }
}
```

## Task 3: Deliver snapshots through hibernating WebSockets

**Files:** Modify `workers/briefing/job.ts`, `workers/briefing/index.ts`; create `workers/briefing/socket.unit.ts`; extend `shared/briefingJob.defs.unit.ts`.

**Interfaces:** Consumes Task 2's job snapshot. Produces `GET /api/briefings/{hash}/events` on the public briefing-service Worker hostname and `BriefingJobEvent` frames. Subscriptions cannot write or enqueue.

- [ ] **Step 1: Write failing runtime tests.** Upgrade from the exact preview-site Origin succeeds in preview; only `http://localhost:5173` is additionally accepted by the local default environment. Another Origin, malformed hash, non-upgrade GET, and public POST fail. Subscriber A before generation, B after completion, and C after a process restart each receive a current snapshot and exactly the canonical available briefing; a second invalid output yields terminal unavailable and closes both sockets. Reconnecting a socket makes zero Queue/provider calls. Verify monotonic revisions and close-on-terminal behavior. The test's `mf` is its isolated `Miniflare` workerd runtime, not a fabricated in-process socket handler.

```ts
const request = new Request('https://briefing.example/api/briefings/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/events', {
  headers: { Upgrade: 'websocket', Origin: 'https://can-i-update-preview.caniupdate-dev.workers.dev' },
});
expect((await mf.dispatchFetch(request)).status).toBe(101);
```

- [ ] **Step 2: Run `nub x --node vitest run workers/briefing/socket.unit.ts` and observe red upgrade/reconnect cases.** Exercise actual workerd/WebSocketPair for the hibernation path; Node-only simulated messages do not establish browser routing.
- [ ] **Step 3: Implement public read-only upgrade and job-side hibernation.** Check exact Origin, method, path, and 64-character lowercase hash in `index.ts`; relay only the Upgrade request to its job DO. In `job.ts`, call `ctx.acceptWebSocket(server)`, reconcile D1 before sending an initial stored revision, and send terminal event then close every socket returned by `ctx.getWebSockets()`. Use an immutable event envelope with no prompt, packet, credential, or provider error. Connecting or reconnecting must not call submit.

```ts
const pair = new WebSocketPair();
const [client, server] = Object.values(pair);
this.ctx.acceptWebSocket(server);
server.send(JSON.stringify(await this.reconciledSnapshot()));
return new Response(null, { status: 101, webSocket: client });
```

- [ ] **Step 4: Re-run the focused tests and a local public-hostname WebSocket handshake.** Check the object can hibernate/restart without losing a subscriber's ability to receive a terminal event. Commit the socket feature only after an actual 101/snapshot/completion sequence.

## Task 4: Cut over the Nuxt API and comparison page atomically

**Files:** Create `server/api/package/[packageName]/compare/briefing.post.ts` and `.post.unit.ts`; modify `shared/cloudflare.d.ts`, `wrangler.jsonc`, `app/composables/packageBriefingQueryOptions.ts`, `app/composables/useComparisonPage.ts`, `app/components/comparison/BriefingPanel.vue`, `app/pages/[packageName]/[versionPair].vue` and their focused tests; remove `server/api/package/[packageName]/compare/briefing.get.ts` and `.get.unit.ts`. Migrate `server/utils/packageBriefing.ts` callers; remove obsolete synchronous-only exports once unused.

**Interfaces:** Consumes Task 1 `BriefingSubmission`/`BriefingJobEvent`, Task 2 private binding, Task 3 socket URL. Produces the POST 200/202 client protocol and existing `PackageBriefingResponse` query result after socket completion. Add `waitForJobEvent(url: string, revision: number, signal: AbortSignal, onStatus: (state: 'queued' | 'running') => void): Promise<PackageBriefing>` to the briefing composable; it decodes snapshots, reports queued/running to `useComparisonPage`, closes on terminal/abort, and reconnects at most three times (1, 2, then 4 seconds) on transient disconnect. Exhausted reconnects reject without another POST. Preserve `resolvedBriefingVersions`, `buildBriefingCitations`, and independent declarations/measurements queries.

- [ ] **Step 1: Write failing API/client behavior tests.** Assert invalid package/versions fail before evidence access; missing evidence/briefing binding returns sanitized 503; bounded packet goes to private binding; 200 renders existing citations; 202 returns pending until a socket `available` frame updates the same Vue Query entry. Route change/abort closes the old socket; a socket reconnect obtains snapshot only and does not POST again; unavailable finishes pending and leaves factual rows intact. Delete tests that pin the old GET URL rather than rewriting them to reassert synchronous behavior.

```ts
expect((await handler(validEvent)).status).toBe(202);
expect(privateSubmission).toHaveBeenCalledTimes(1);
expect(evidenceRequest).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'minimist' }));
```

- [ ] **Step 2: Run `nub x --node vitest run server/api/package/'[packageName]'/compare/briefing.post.unit.ts app/composables/packageBriefingQueryOptions.unit.ts`; record the red API/transition failures.** Existing unrelated deleted-helper failures do not authorize restoring that file.
- [ ] **Step 3: Implement a thin POST route and client state transitions.** Request exact resolved versions from the existing declarations response, obtain `getBriefingEvidence`, pass the bounded packet only through `BRIEFING_SERVICE`, and return its decoded 200/202. Set the Nuxt `PACKAGE_EVIDENCE`/`BRIEFING_SERVICE` bindings in default and preview configs; move D1 and all three AI settings out of Nuxt's runtime once no caller remains. In the same cutover, point `db:migrate:local` and preview remote migration commands at `workers/briefing/wrangler.jsonc`, preserving the existing local/remote D1 database IDs and data. In the client, a 202 opens one WebSocket; pass an `onStatus` callback from `useComparisonPage` through `packageBriefingQueryOptions` so queued/running is visible while its query promise remains pending. Decode the first snapshot before handling live messages; resolve the same Vue Query entry on `available`/`unavailable`, close on terminal, reconnect with bounded backoff for transient disconnects, and ignore events for a superseded comparison and clear its queued/running status when the query key changes. `retry: false` prevents query retries from accidentally submitting a new paid generation. Render queued/running explicitly in the existing panel; keep source/citation rendering intact.

```ts
const response = await requestFetch<BriefingSubmission>(`/api/package/${encodeURIComponent(packageName)}/compare/briefing`, {
  method: 'POST', query: { from, to }, retry: false, signal,
});
if (response.status === 'available') return response;
const briefing = await waitForJobEvent(response.eventsUrl, response.revision, signal, onStatus);
return { packageName: response.packageName, from: response.from, to: response.to, briefing };
```

- [ ] **Step 4: Re-run focused tests and smoke the actual compare page locally.** Confirm 200 cached and 202 pending/completed paths in the browser, including reload and comparison change. Remove the obsolete GET handler and its process-env AI usage in the same cutover; no side door may still generate on GET. Commit the API/client cutover after this changed path is exercised.

## Task 5: Make local and built runtimes reproducible, then document the gate

**Files:** Modify `scripts/dev.ts`, `package.json`, `nuxt.config.ts` only where needed for the three-worker dev/build/preview config; update `.env.example`, `README.md`, `docs/cloudflare-handoff.md` after smoke; modify `workers/briefing/wrangler.jsonc` if the real workerd probe identifies a binding/path adjustment.

**Interfaces:** All earlier tasks; no new public API. `nub run --node dev` still owns startup/shutdown and HMR; `nub run --node preview` runs built Nuxt plus evidence and briefing Workers without remote bindings. No remote command is executed by this task.

- [ ] **Step 1: Add a failing startup/smoke scenario against an isolated local persistence directory.** Start evidence and briefing Workers, then Nuxt; run a request with a fixture provider through POST → WebSocket available → D1 hit after restart. Confirm only one runtime owns each local binding and a build does not erase local D1/DO state. Stop all processes on Ctrl-C or sibling failure. Do not run `dev` and `preview` concurrently against the same state.
- [ ] **Step 2: Run the local scenario to locate the missing binding/routing before editing launch code.** Preserve the existing `.wrangler/state`; use a separate temporary persistence root for destructive fault tests. A separate local port for the public briefing Worker is acceptable; frontend submission remains a private binding. Prove that Wrangler can serve both ports without concurrent ownership of the same D1 database; if it cannot, use separate local sessions with only the briefing Worker bound to D1 and no duplicate local database owner.
- [ ] **Step 3: Wire the supervisor, build dry-run, and preview configs, then repeat the scenario.** `scripts/dev.ts` starts evidence on 8790 and briefing on 8791, waits for both, then starts Nuxt HMR; with `--preview` it starts the built `.output/server/wrangler.json` frontend on 5173 instead. Shutdown terminates all three. `package.json` builds/dry-runs both backend bundles, checks standalone briefing TS, and routes `preview` through that launcher so the public socket has its own local port. Local provider fixture credentials live exclusively beside briefing Worker config and are never copied into `.output/server/.dev.vars` after cutover. Document the two browser-facing hostnames and exact run/deploy order; do not copy secrets into repo docs.

```json
{
  "build": "nuxt build && wrangler deploy --dry-run --config workers/evidence/wrangler.jsonc --env= && wrangler deploy --dry-run --config workers/briefing/wrangler.jsonc --env=",
  "type-check": "nuxt typecheck && tsc --project workers/evidence/tsconfig.json && tsc --project workers/briefing/tsconfig.json",
  "preview": "node scripts/dev.ts --preview"
}
```

- [ ] **Step 4: Verify and document only observed behavior.** Run focused job/socket/API tests, Nuxt and backend type checks, lint/format, and dry-run builds **after** the user-owned deleted test helper has been separately resolved; otherwise report exact blocked checks and still exercise the new local workerd/browser paths. Profile actual built Nuxt briefing submission CPU separately from the job DO and Queue consumer; sample cold/warm/repeated requests and concurrent subscribers. If sustained Free 10 ms frontend/consumer CPU or Free DO/Queue/D1 quotas cannot be met, stop the public rollout instead of declaring success. Never install a real OpenRouter key or deploy remotely as part of verification. Update docs with commands, failure semantics, key budget requirement, quotas, measured samples, and remaining approval gates. Commit these runtime/docs changes after successful local smoke.

## Completion and handoff

No remote deployment is implied by completing these local tasks. Before any later isolated preview deployment, obtain explicit approval for new Queue/DO resources, migration, public socket Worker, and OpenRouter secret; create the preview Queue, apply the existing D1 migration through the briefing config, deploy the private evidence Worker (if changed), then the briefing Worker and finally the Nuxt service binding, with rollback and stored observability. Enable paid inference only after the user has configured the OpenRouter key budget and the measured Free-tier/browser gates pass. Preserve the unrelated deleted `test/helpers/briefingD1.ts` as the user's change until they resolve it.
