# Cloudflare handoff

## Latest preview redeployment and smoke (2026-10-01)

Rebuilt the current checkout with `nub run --node build`, then deployed evidence, briefing, and frontend Workers in order to `preview` using the external `cloudflare.env`. The preview Queue already existed; remote D1 reported no pending migrations. No credentials or billing configuration were changed.

- Frontend/API: `bed260ed-6436-4102-827b-4a2931a2035d`.
- Evidence Worker: `45aee260-6d6f-4111-a8a5-8f5faf891a02`.
- Briefing Worker: `66d9f05f-67cf-464d-bc85-ca7db267cab0`.

Authenticated checks using the external `access.env` returned HTTP 200 for health (`{"status":"ok"}`), minimist search and metadata, minimist `1.2.5...1.2.8` declarations and measurements, and scoped `@vue/shared` `3.5.13...3.5.22` measurements. Comparison response identities matched the requested pairs. Minimist evidence reported 21/24 tarball files, a −11 B gzip delta, and 1/0 matched advisories.

Headless Chromium exercised hydrated homepage search, package selection, the From version picker, navigation to `/minimist/1.2.5...1.2.8`, and a direct reload. The rendered page showed the same measurements and advisories; a full-page screenshot confirmed the surface and no browser errors were recorded. On reload, measurements and briefing POST both returned 200; the page showed two evidence-linked AI notes. Per the submission contract, briefing 200 is a stored result, not a queued generation. This was a basic smoke check, not a load or paid-generation test.

## Earlier preview deployment and load run (2026-10-01)

All current frontend/API, evidence, and briefing Worker code was deployed to the explicit `preview` environment after the scoped-admission commit `fe6cfe9`. The existing preview Queue was confirmed and remote D1 reported no pending migrations. No AI credentials were added and no inference request was sent.

- Frontend/API: `5e85f5ac-c947-4c95-9224-a4f3ccf70152`.
- Evidence Worker: `f07e3512-67cb-4ca9-9e47-ec14d91eb6a7`.
- Briefing Worker: `427f1ba8-7612-4ce6-aaff-b0dec9e3e749`.

Build and deployment completed. Access initially redirected the health check to login until the Service Auth policy was saved; afterward `/api/health` returned `200 {"status":"ok"}` with the locally stored service token. Preflight GETs for all six selected measurements pairs returned validated 200 responses and warmed their evidence. The one-minute warm-cache results are below. Existing sections below are historical where they describe the older deployment.

**Current status (2026-10-01):** Frontend/API, evidence, and asynchronous briefing Workers are deployed to the approved remote preview. D1 has no pending migrations. No AI credentials were deployed and no inference was run; billing was unchanged.

### Warm-cache measurements load run

One generator ran authenticated GETs to the public measurements API, with no retries, a 30-second request timeout, and paced arrivals for exactly 60 seconds per rate/workload. The six unique pairs were first fetched sequentially (preflight, 509–1,730 ms each; all 200) to warm their evidence, then reused during the rate windows. Each response had to be valid JSON matching its requested package/from/to versions.

| Workload                                         |     Rate | Requests | HTTP 200 | Other/failures | Max in flight | Latency p50 / p95 / p99 |
| ------------------------------------------------ | -------: | -------: | -------: | -------------: | ------------: | ----------------------: |
| TypeScript, 3 version pairs                      | 10 req/s |      600 |      600 |              0 |             1 |         26 / 31 / 36 ms |
| TypeScript, 3 version pairs                      | 25 req/s |    1,500 |    1,500 |              0 |             2 |         25 / 30 / 37 ms |
| Mixed: TypeScript (3 pairs), Nuxt, Vue, minimist | 10 req/s |      600 |      600 |              0 |             2 |         26 / 44 / 50 ms |
| Mixed: TypeScript (3 pairs), Nuxt, Vue, minimist | 25 req/s |    1,500 |    1,500 |              0 |             4 |         26 / 41 / 51 ms |

Achieved send rates matched target; zero requests were skipped. The largest response was Nuxt (~91 KB); the rest were ~3–8 KB. This indicates the deployed route handled this **single-location, prewarmed, low-in-flight** sample without application failures or admission rejection. It does **not** test cold archive/provider work, three-region routing, greater parallelism, or Cloudflare per-invocation CPU accounting. Per-request timings are end-to-end client-observed latency, not Worker CPU time. Detailed sanitized results: `.data/preview-load-2026-10-01.json` (ignored local evidence).

Historical 2026-09-24 deployment smoke: health, minimist measurements/briefing, and two sequential TypeScript 5.8.3 → 5.9.3 measurement requests returned 200. TypeScript DO CPU was 352 ms then 6 ms; frontend CPU was 2 ms for each. Chromium hydrated search returned results and direct minimist comparison populated sizes, advisories, and 20/24-file inventories. Browser input was exercised through DOM input events because tool-level click/type timed out. Homepage (80 ms), comparison SSR (77 ms), and briefing frontend (59/68 ms) samples exceeded 10 ms, with outcome `ok`. These are individual historical live-tail samples, not a load test; the 2026-10-01 run below measures client-observed latency only and does not establish sustained Free-tier suitability. Sanitized evidence: `.data/preview-deployment-2026-09-24.json`.

The sections below retain local and deployment history from before 2026-10-01; treat their deployment status and load claims as historical. The current deployment versions and measured warm-cache workload are recorded above. The [optimization plan](optimization-plan.md) records selected and deferred work; the original M1 plan remains execution history.

## Local and built runtime gate (2026-09-26)

Task 5 recorded local and built-runtime procedures; these commands remain local only, use the loopback fixture in the git-ignored `workers/briefing/.dev.vars`, and start no remote session. The separate 2026-10-01 remote deployment and warm-cache load run are recorded above.

### What the runtimes are

- `nub run --node dev` starts three processes through `scripts/dev.ts`: the evidence Worker on `8790` (inspector `9230`), the briefing Worker on `8791` (inspector `9231`), then Nuxt with HMR on `5173`. `nub run --node preview` runs the same launcher with `--preview`, replacing Nuxt with the built Worker from `.output/server/wrangler.json`.
- The migration runs through `workers/briefing/wrangler.jsonc`: that Worker is the only local owner of D1. The root `wrangler.jsonc` declares no D1 binding, so the Nuxt dev proxy and the built frontend never open the database.
- The frontend resolves both private bindings by name through Wrangler's dev registry (`PACKAGE_EVIDENCE` Durable Object and `BRIEFING_SERVICE` → `BriefingSubmitter`), so each runtime runs in its own local session and a single D1 owner is enough. Two sessions sharing one local D1 database are not needed and are not used.
- Every session passes `--persist-to .wrangler/state`; the launcher takes `launcher.lock` in that root, so `dev` and `preview` cannot own the same state concurrently. Ctrl-C stops all three processes: after a run, `5173`, `8790`, and `8791` are free again (asserted by the smoke scenario).
- The private submission envelope now crosses the RPC boundary as JSON text. workerd attaches an own `Symbol.dispose` to every object it deserializes for a caller, and the frontend decodes the envelope strictly (`onExcessProperty: 'error'`, which walks `Reflect.ownKeys`), so an object-returning entrypoint failed the first built-runtime run with `SchemaError: Expected no excess property` and a sanitized 503 before this fix.

### The scenario and its observed output

`node scripts/smoke.ts [--preview] [--measure]` runs the whole path against a temporary persistence root, offset ports, and a private dev registry, so it never touches `.wrangler/state` or a live session. It starts the loopback fixture on the port `workers/briefing/.dev.vars` names, and refuses to run if that endpoint is not loopback.

Both modes passed the same scenario: POST → socket `available` → restart → D1 hit → reconnect.

| Step                                         | dev (`node scripts/smoke.ts`)                               | preview (`node scripts/smoke.ts --preview`) |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| POST `minimist 1.2.5...1.2.8`                | `202` `queued`, `eventsUrl` on `8891`                       | `202` `queued` (777 ms)                     |
| Socket                                       | `running@2 → available@3`, close `1000 briefing complete`   | same                                        |
| Provider calls for that package              | exactly 1                                                   | exactly 1                                   |
| Restart (`SIGINT`, exit 130, ports released) | migration reports "No migrations to apply", D1 row survives | same                                        |
| POST after restart                           | `200 available` from D1 (110 ms)                            | `200 available` (113 ms)                    |
| Socket reconnect                             | `available@3`, close `1000`; provider count unchanged       | same                                        |

The restart also proves the persistence contract: the D1 row and the job object's state live under the same root the second run reopens, so a settled job answers from D1 without a provider call and a reconnect never starts inference.

### CPU samples

Method: for each window, the CPU of the whole process tree of one runtime (the Wrangler process and its `workerd`), summed from `/proc/<pid>/task/<tid>/schedstat` in nanoseconds, divided by the requests the window drove. A 5-second idle window is reported per second instead of per request. Three warm POST bursts of 30 requests each, one cold generation, one settled reconnect, and 8 concurrent subscribers, all on the built (`--preview`) runtime:

| Window                              | frontend (`5273`) | briefing Worker (`8791`) | evidence Worker (`8790`) |
| ----------------------------------- | ----------------- | ------------------------ | ------------------------ |
| idle, 5 s                           | 10.23 ms/s        | 8.05 ms/s                | 7.65 ms/s                |
| warm POST (D1 hit) ×30              | 7.051 ms/request  | 3.303 ms/request         | 5.370 ms/request         |
| cold POST to terminal frame         | 15.728 ms         | 42.767 ms                | 48.122 ms                |
| settled socket reconnect            | 1.238 ms          | 8.987 ms                 | 1.245 ms                 |
| 8 concurrent subscribers            | 0.235 ms each     | 5.567 ms each            | 0.178 ms each            |
| `vue 3.4.38...3.5.13` warm POST ×30 | 6.699 ms/request  | 3.262 ms/request         | 5.218 ms/request         |

Read these as local process-tree CPU, not as Cloudflare's per-request accounting: local `wrangler dev` also captures observability traces, and the numbers include runtime bookkeeping. They are evidence about _where_ the work is and how it scales, not a deployment measurement.

- The ordinary-Worker path that the 10 ms allowance covers is the frontend POST (Nuxt Worker) and the briefing Worker's submission entrypoint plus Queue consumer. The frontend POST measured ~6.7–7.1 ms of process-tree CPU per warm request for two different packages, which is closer to the 10 ms allowance than the previous synchronous route's live-tail samples (35–140 ms) but leaves little headroom; the briefing-side submission path measured ~3.3 ms.
- The cold generation (~43 ms of briefing-Worker CPU) and the socket/subscriber paths run inside the job Durable Object, whose allowance is 30 seconds; the Queue consumer and the service-bound submission are ordinary invocations. A single process contains both, so these windows attribute runtime, not invocation type.
- No local sample produced an exceeded-CPU result, and the D1, Queue, and Durable Object usage in this scenario is small (one row, one message, one job object per pair).

### Browser observations on the real page

Driven in Chromium against the running preview runtime (`http://localhost:5273`):

- Changing the comparison while a briefing is pending (a client-side route change to another pair, and separately leaving the comparison) closed the abandoned subscription — measured as `readyState 2 (CLOSING)` on the recorded socket — and made no additional provider request: the loopback fixture's count for the abandoned package was unchanged before and after. A settled job's own socket still closes normally with `1000 briefing complete`.
- A cold pair whose submission is refused with the route's sanitized 503 recovered: with the first POST failed at the transport and the client's single resubmission allowed through, the page issued exactly two POSTs 253 ms apart and then rendered the briefing. A control run of the same cold pair without the injected failure issued exactly one POST.
- Environment artifact worth knowing when reading socket logs: a client `socket.close()` against these local workerd sockets leaves the socket in CLOSING without ever firing a `close` event (reproduced with a manual control socket), so "the client closed the subscription" must be read from `readyState`, not from a close event. The composable's reconnect path keys on close events and was therefore not exercised by client-initiated closes locally.

### Gates that remain unapproved

The Queue, SQLite-backed briefing job Durable Object, briefing Worker, and public read-only socket route were deployed to preview on 2026-10-01 at the user's direction. Remaining gates:

1. Keep the `env.preview` OpenRouter secret unset until access/abuse controls and an approved spend budget are in place. This load test did not submit a briefing or incur inference charges.
2. Measure deployed per-invocation CPU under representative sustained traffic. The warm-cache request results above are client latency only; they do not establish Cloudflare CPU accounting, cold-work behavior, or Free-tier suitability.

## Completed work

| Commit    | Delivered                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ad52e96` | Public Effect HTTP npm transport; request-bound D1 permanent briefing store; read-only legacy SQLite exporter; local migrations, Nuxt development, and built-Worker preview |
| `dda154a` | Removed the rejected Effect patch, process-local provider caches, and inference coalescing; retained request-local manifest sharing and durable D1 reuse                    |
| `20be28b` | Fixed Firefox startup by disabling Nuxt's entry-import-map optimization; SSR streaming remains enabled                                                                      |
| `5cda662` | Added an isolated remote `preview` environment and deployed it with a separate D1 database and no AI credentials                                                            |
| `fe6cfe9` | Replaced manual evidence admission counters/releases with scoped reject-fast Effect semaphores; added lifecycle tests and documented permit ownership                       |

The Firefox failure was real: HTTP module-preload headers interacted with the `#entry` import map, leaving server-rendered HTML visible but non-interactive. A clean Firefox session produced `NUXT_E1005`, an unresolved `#entry`, and no API requests. Direct chunk imports restored search and comparison hydration. API-only checks had missed this; future verification must exercise actual browser interactions.

### Contracts retained

- A successful briefing is permanent and keyed by SHA-256 of the bounded model-visible evidence packet. No TTL or model, prompt, endpoint, or credential invalidation.
- D1 is read before provider configuration/inference. Failed reads fail closed; failed writes cannot be reported as durable success. A write failure after generation cannot undo its cost.
- Concurrent successful inserts return the first stored winner, not each caller's independently generated text.
- Evidence is shared through the private SQLite-backed DO namespace, not an isolate-local Effect Cache. Verified archive inspections persist by integrity/revision; successful mutable provider evidence expires after five minutes. AI inference is coalesced only per evidence hash by that hash's job object: duplicate submissions for one hash share a single generation, while concurrent D1 misses for different packets can independently incur provider costs.
- Provider URL/credential/redirect checks, schema validation, archive integrity and resource bounds, existing deadlines, and partial-result semantics remain intact. Do not reintroduce the Effect patch or shared Effect Cache to improve performance.
- The legacy SQLite source was not automatically imported, modified, or deleted. Its read-only exporter remains available for an explicit migration.

### Current local evidence implementation

- `workers/evidence/index.ts` exports the native `PackageEvidence` Durable Object. Helpers use JavaScript private methods; only the validated HTTP entry is exposed. Objects are named by npm package. The top-level Worker has no public application endpoint.
- Measurements and briefing evidence require `PACKAGE_EVIDENCE`. Full inventories and packet packing stay in the backend; the Nuxt Worker receives summaries or a bounded 48 KiB / 64-source packet and retains AI generation plus D1 result storage. Missing bindings/storage fail closed with 503, without frontend archive fallback.
- Internal failures keep their tags through the Effect/cache bridge: registry requests, cache/storage operation errors, persisted-data corruption, capacity exhaustion, and unexpected collection failures remain distinct. The evidence Worker classifies capacity by typed error instance, not by walking `cause`; only archive/response exhaustion receives the existing `Retry-After`. The public binding client separately identifies missing binding, transport, upstream HTTP, and protocol/decode failures; API routes map each to the same sanitized 503. The briefing store reserves `undefined` for a missing row and tags D1 operation failures separately from corrupt rows and invalid write input. Job handlers retain the existing unavailable/cache-error outcomes for tagged store failures and propagate unexpected defects.
- Archive downloads remain bounded and integrity-verified before 64 KiB streaming gunzip/tar inspection. An Effect scope owns the parser, gunzip stream, feed/output pumps, and entry inspection; bounded output backpressure is preserved, and interruption or failure tears down and joins the owned work. Strongest SRI selection, SHA-1 fallback rules, archive/path/link limits, per-file hashes, and partial-result semantics remain intact.
- A built local workerd preview returned HTTP 200 for minimist 1.2.5→1.2.8 and Vue 3.4.38→3.5.13 measurements; all four tarballs were `available` (21/24 minimist files and 37/37 Vue files), with complete unpacked-size comparisons. A Miniflare workerd fixture also exercised valid, malformed, and over-limit archives.
- Module-scoped, reject-fast Effect semaphores bound admission per isolate: two archive inspections, two distinct collection/response jobs, and sixteen pending HTTP requests including coalesced callers. Each permit wraps its owning Effect and releases on every exit; one shared collection owns one response permit, while its waiters own none. There is no cross-object promise queue or claimed global memory bound. Shared cache population remains DO-owned on caller disconnect and uses the existing provider deadlines.
- Real workerd fixtures observed one pair of archive downloads and one OSV lookup for concurrent cold measurements/briefing. Warm requests and a fresh runtime using the same SQLite state made zero additional upstream calls. Each large inspection was 4,981,761 bytes across 112 Unicode-safe chunks.
- Expiry refreshed mutable providers without re-reading archives. Changed integrity re-inspected one archive; temporary download failures recovered; unsafe URLs and malformed strong SRI were rejected even with reusable weaker/cached evidence. Equal integrity reused an inspection under a different version and validated URL.
- A gated 24-request burst produced sixteen successful coalesced responses and eight temporary 503s, with only one OSV lookup. A forced failure on the second SQL chunk rolled back the whole record and recovered after the fault was removed. Missing chunks and schema-invalid cached JSON returned 503 without redownloading; restoring valid data recovered normally.
- Final checks passed: 23 test files / 175 tests, Nuxt and standalone backend type checks, formatting, and the Nuxt plus backend dry-run build. Lint has zero errors and five pre-existing style warnings. No lint suppressions or dependency patches were added.
- Built preview browser checks exercised package search, scoped-package navigation, progressive measurements, and direct minimist reload. Minimist showed 24-file archive summaries and populated size/advisory rows. The existing strict `package/` archive-root rule still rejects the tested `@types/minimist` archives; unrelated evidence remains available. AI-disabled briefing returned `not-configured`, not `cache-error`.
- Nuxt dev was launched separately after stopping preview. Its external HTTP DO binding returned the same minimist archive summaries and `not-configured` briefing. Both modes use `.wrangler/state`; never run them together.

Detailed local runtime results are in the ignored `.data/evidence-runtime-results.json`. They demonstrate functional reuse and failure behavior, not deployed CPU savings or a guaranteed 128 MiB peak. Immutable archives have no eviction policy; storage/duration/request quota monitoring remains a rollout gate.

### Earlier compatibility verification

- 23 test files / 177 tests passed after cache removal, including real Miniflare D1 persistence and concurrent first-writer-wins coverage.
- Type checking, formatting, Cloudflare build, and commit hooks passed. Lint reports zero errors and eight existing style warnings.
- Four concurrent actual local Worker requests succeeded without the Effect patch. Four gated synthetic-provider generations yielded one stored D1 winner; repeat and provider-unconfigured restart requests reused it without additional generations.
- Actual Firefox and Chromium search/comparison flows passed locally and on the remote preview. Remote Firefox also passed search-to-comparison navigation and direct reload, with no startup errors or stuck measurement rows.
- Remote minimist `1.2.0...1.2.8` rendered size estimates, advisory evidence, and 20/24-file tarball summaries. The briefing endpoint returned `not-configured`, not `cache-error`; remote D1 had zero stored briefings. No paid inference was tested.
- Earlier HMR and navigation/disconnect checks passed locally. Existing Nuxt experimental SSR-streaming warnings were not suppressed; they are distinct from the fixed Firefox import-map failure.

## Current environments and operational boundaries

- Remote site: <https://can-i-update-preview.caniupdate-dev.workers.dev>
- Account: `caniupdate.dev`; Worker: `can-i-update-preview`; D1: `can-i-update-preview-briefings`.
- Verified deployment version: `aa84cd10-65f4-4a03-b50b-542f66169386`. Account and database IDs are in `wrangler.jsonc` under `env.preview`.
- The deployed preview has only `ASSETS`, `BRIEFINGS_DB`, and the evidence Durable Object binding. The local runtime now also requires `BRIEFING_SERVICE` (targeting `can-i-update-preview-briefing` remotely) and the briefing Worker's Queue, job Durable Object class, D1 database, and public socket route. Deploy the evidence Worker first, then the briefing Worker, then the frontend, only with explicit approval. No AI credentials, custom domain, KV, or billing changes have been deployed by this implementation, and the Queue and briefing Worker remain undeployed.
- The restricted token cannot read billing subscriptions; the deployment did not independently verify the account's billing plan. No billing changes were requested or performed.
- The default Wrangler environment remains local-only. `nub run --node preview` starts the local Worker; it does not select the remote environment. Remote commands require `--env preview`, and migrations additionally require `--remote`.
- Deployment credentials remain in the user's `~/.config/can-i-update/cloudflare.env`, outside the repository. Never print the token, copy it into application configuration, or replace another project's Wrangler OAuth login.
- Local dev and built preview share `.wrangler/state`; do not run them concurrently or delete that directory as test cleanup. Earlier experiments and their diagnostic evidence remain in their separate worktrees. A different checkout has a different local state directory; merging does not migrate local data.

See the [README deployment commands](../README.md#remote-preview-trial). Stop a preview before rebuilding the output it serves. Do not remove earlier experiment worktrees or their local state as implementation cleanup.

## Deployment follow-up: CPU usage and visibility

### What was measured

The following are individual samples from Cloudflare's live `wrangler tail --format json` stream, not averages, percentiles, or a load test:

| Request                   | CPU time | Wall time | Result                   |
| ------------------------- | -------- | --------- | ------------------------ |
| Homepage `/`              | 91 ms    | 96 ms     | 200, `ok`, no exceptions |
| Search for minimist       | 31 ms    | 474 ms    | 200, `ok`, no exceptions |
| Minimist comparison HTML  | 43 ms    | 280 ms    | 200, `ok`, no exceptions |
| Minimist measurements API | 35 ms    | 1,051 ms  | 200, `ok`, no exceptions |
| Minimist briefing API     | 140 ms   | 1,040 ms  | 200, `ok`, no exceptions |

The comparison was `1.2.0...1.2.8`. A later briefing sample used 22 ms CPU; do not infer a proven cold/warm distinction from request order alone. Network waiting is excluded from CPU time. The briefing route still collects evidence before `getPackageBriefing` checks D1 and provider configuration, so its CPU cost exists even with AI disabled.

These samples exceed the [documented Workers Free 10 ms CPU allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Cloudflare permits some occasional overruns. We observed successful over-allowance requests, **not an exceeded-CPU error**, and have not established reliable sustained Free-tier operation.

### Why the dashboard has no stored logs

Stored Workers Logs are now configured in both Workers' `env.preview` settings with `observability.enabled: true` and `head_sampling_rate: 1`. This configuration has not been deployed yet; rebuild and deploy both Workers, then generate new requests and check each Worker's **Observability** tab. Live tail worked independently while a diagnostic connection was open; that connection has been stopped. The historical live stream does not become dashboard log history retroactively.

[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) currently includes 200,000 events/day and three-day retention on Free. Invocation records expose request-level CPU, wall time, status, and outcome; they do not identify the expensive functions.

### Remaining deployment verification

The local investigation and DO/streaming feasibility work informed the approved implementation above. The following remote visibility and before/after gates are still outstanding; they are not authorization to deploy or upgrade a plan.

1. Deploy the configured stored invocation logs **only under `env.preview`** for both Workers, using `observability.enabled: true` and `head_sampling_rate: 1` for this low-volume diagnostic trial. Confirm newly generated frontend and evidence requests are visible in each Worker's dashboard. Reconsider sampling if traffic grows; avoid logging credentials, raw provider bodies, or unnecessary request data. Configuration and dry-run validation are complete; remote deployment and dashboard verification remain pending.
2. Record a small, repeatable route matrix: homepage, search, metadata, declarations, measurements, and briefing evidence. Include minimist and a larger/scoped package. Keep AI disabled. Record sample count, versions, CPU/wall time, status/outcome, and first versus repeated requests; do not label a request cold without evidence.
3. Separate HTML rendering from API costs and determine whether overruns persist across repeated requests. Include a limited concurrency check after the sequential baseline, not an unbounded stress test.
4. Capture a CPU profile of the **built Worker locally**, with equivalent requests and data: start Wrangler preview, attach DevTools, record in the Profiler, issue the selected request, and stop recording. Use bottom-up function/self-time and garbage-collection views. Local measurements identify hotspots; their absolute timings are not interchangeable with Cloudflare production CPU numbers. See [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
5. Keep attributing remaining frontend CPU separately from evidence work. Comparison SSR reduction, unused per-file hashes, and response-header tracing remain in the optimization backlog; homepage prerendering is implemented and must be included in the next deployment sample. Do not use `Date.now()`/`performance.now()` around production code as a substitute for CPU profiling; Workers restrict timer advancement around I/O.
6. Propose the smallest evidence-backed change, preserve the storage/security contracts above, and compare before/after profiles and deployed request samples. Repeat Firefox and Chromium workflows. If Free remains unsuitable, report that and obtain a hosting decision rather than silently upgrading or weakening evidence collection.

**Deployment exit gate:** reproducible request-level observations, before/after CPU and wall-time samples, concurrent memory/storage/quota checks, and an explicit hosting decision. Local cache correctness and the isolated DO probe do not establish sustained Free-tier suitability. No paid plan or deployment is approved by this handoff.

## What follows after CPU investigation

1. **Remaining compute/rollout work:** follow the recorded optimization backlog and obtain approval for deployment measurements. The selected persisted-evidence cache is now implemented locally; do not restore isolate-local Effect caches or confuse mutable evidence with permanent briefing snapshots.
2. **M2 — durable generation:** implement job coordination and immutable packet storage, Queue dispatch/recovery, execution leases, bounded attempts/spending, and D1 reconciliation. D1's first-writer-wins result alone does not prevent duplicate provider charges. Verify crash windows and duplicate delivery before client cutover.
3. **M3 — client/API cutover:** replace synchronous generation with typed submission/read endpoints and hibernating Durable Object WebSocket notifications. Preserve progressive facts, citations, reconnection behavior, and no browser status polling; remove the old generation path only after end-to-end verification.
4. **M4 — production readiness:** extend this preview trial into operational gates: access/abuse protection, approved budgets and credentials, runtime/resource limits, migrations and explicit legacy-data import, failure visibility, rollback, and deployment procedures. The current preview is only part of M4's evidence, not completion of M4. Do not publicly enable paid inference before spend/access controls.

Later milestones need their own implementation plans and approval. Their contracts and failure scenarios are in the [durable briefing design](superpowers/specs/2026-09-22-cloudflare-briefing-migration-design.md); the [M1 implementation plan](superpowers/plans/2026-09-22-cloudflare-compatibility.md) is historical, including explicitly superseded cache/patch steps.

## Evidence and resumption

Durable source-controlled evidence is summarized here and in the README. More detailed local artifacts remain under `.superpowers/sdd/2026-09-22-cloudflare-compatibility/` in the feature worktree and are intentionally ignored:

- `worker-uncached-concurrent.json`, `worker-uncached-reuse.json`, `worker-uncached-restart.json`: unpatched concurrency and durable-result reuse.
- `firefox-preview-hydration.json`: Firefox failure, controlled preload-header experiment, and repaired browser flow.
- `remote-preview-deployment.json`: deployment/migration output, browser checks, bindings/database observations, and CPU samples.

Do not rely on those ignored files being available in another clone. Begin the next session with this handoff, the README commands, the target account/environment, and fresh observations. Resume from the optimization plan and current source, then choose the next deferred slice or approve deployment verification explicitly. Successful local smoke does not establish production readiness.
