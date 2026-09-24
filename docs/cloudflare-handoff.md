# Cloudflare handoff

**Status:** Shared persisted evidence and DO-backed streaming cache misses were deployed to the approved remote preview on 2026-09-24. Backend version: `04618599-82a3-4157-9337-862dec46d38d`; frontend version: `7006c87d-970c-4556-8a6d-3aa4188c5d9f`. No pending D1 migrations. AI remains unconfigured; billing is unchanged.

Deployment smoke: health, minimist measurements/briefing, and two sequential TypeScript 5.8.3 → 5.9.3 measurement requests returned 200. TypeScript DO CPU was 352 ms then 6 ms; frontend CPU was 2 ms for each. Chromium hydrated search returned results and direct minimist comparison populated sizes, advisories, and 20/24-file inventories. Browser input was exercised through DOM input events because tool-level click/type timed out. Homepage (80 ms), comparison SSR (77 ms), and briefing frontend (59/68 ms) samples still exceeded 10 ms, with outcome `ok`; sustained Free-tier suitability remains unproven. These are individual live-tail samples, not a load test. Sanitized evidence: `.data/preview-deployment-2026-09-24.json`.

The sections below retain earlier local and remote verification history; this deployment supersedes statements that the backend is local-only. The [optimization plan](optimization-plan.md) records the selected scope and deferred work; the original M1 plan remains execution history.

## Completed work

| Commit                | Delivered                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ad52e96`             | Public Effect HTTP npm transport; request-bound D1 permanent briefing store; read-only legacy SQLite exporter; local migrations, Nuxt development, and built-Worker preview |
| `dda154a`             | Removed the rejected Effect patch, process-local provider caches, and inference coalescing; retained request-local manifest sharing and durable D1 reuse                    |
| `20be28b`             | Fixed Firefox startup by disabling Nuxt's entry-import-map optimization; SSR streaming remains enabled                                                                      |
| `5cda662`             | Added an isolated remote `preview` environment and deployed it with a separate D1 database and no AI credentials                                                            |
| Uncommitted on `main` | Private SQLite-backed `PackageEvidence` Worker; shared persisted provider evidence; bounded streaming archive misses; compact frontend binding; two-Worker local runtime    |

The Firefox failure was real: HTTP module-preload headers interacted with the `#entry` import map, leaving server-rendered HTML visible but non-interactive. A clean Firefox session produced `NUXT_E1005`, an unresolved `#entry`, and no API requests. Direct chunk imports restored search and comparison hydration. API-only checks had missed this; future verification must exercise actual browser interactions.

### Contracts retained

- A successful briefing is permanent and keyed by SHA-256 of the bounded model-visible evidence packet. No TTL or model, prompt, endpoint, or credential invalidation.
- D1 is read before provider configuration/inference. Failed reads fail closed; failed writes cannot be reported as durable success. A write failure after generation cannot undo its cost.
- Concurrent successful inserts return the first stored winner, not each caller's independently generated text.
- Evidence is shared through the private SQLite-backed DO namespace, not an isolate-local Effect Cache. Verified archive inspections persist by integrity/revision; successful mutable provider evidence expires after five minutes. AI inference is still not coalesced: concurrent D1 misses can independently incur provider costs.
- Provider URL/credential/redirect checks, schema validation, archive integrity and resource bounds, existing deadlines, and partial-result semantics remain intact. Do not reintroduce the Effect patch or shared Effect Cache to improve performance.
- The legacy SQLite source was not automatically imported, modified, or deleted. Its read-only exporter remains available for an explicit migration.

### Current local evidence implementation

- `workers/evidence/index.ts` exports the native `PackageEvidence` Durable Object. Helpers use JavaScript private methods; only the validated HTTP entry is exposed. Objects are named by npm package. The top-level Worker has no public application endpoint.
- Measurements and briefing evidence require `PACKAGE_EVIDENCE`. Full inventories and packet packing stay in the backend; the Nuxt Worker receives summaries or a bounded 48 KiB / 64-source packet and retains AI generation plus D1 result storage. Missing bindings/storage fail closed with 503, without frontend archive fallback.
- Archive downloads remain bounded and integrity-verified before 64 KiB streaming gunzip/tar inspection. Strongest SRI selection, SHA-1 fallback rules, archive/path/link limits, per-file hashes, and partial-result semantics remain intact.
- Admission is bounded per isolate: two archive inspections, two distinct collection/response jobs, sixteen pending HTTP requests including coalesced callers. There is no cross-object promise queue or claimed global memory bound. Shared cache population remains DO-owned on caller disconnect and uses the existing provider deadlines.
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
- The existing remote deployment has only `ASSETS` and `BRIEFINGS_DB`. The new local configuration additionally requires `PACKAGE_EVIDENCE`, targeting `can-i-update-preview-evidence` remotely. Deploy that private backend first, then the frontend, only with explicit approval. No AI credentials, custom domain, KV, Queues, Durable Objects, or billing changes have been deployed by this implementation.
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

Stored Workers Logs are **not enabled** in the preview configuration. Live tail worked independently while a diagnostic connection was open; that connection has been stopped. The historical live stream does not become dashboard log history retroactively.

[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) currently includes 200,000 events/day and three-day retention on Free. Invocation records expose request-level CPU, wall time, status, and outcome; they do not identify the expensive functions.

### Remaining deployment verification

The local investigation and DO/streaming feasibility work informed the approved implementation above. The following remote visibility and before/after gates are still outstanding; they are not authorization to deploy or upgrade a plan.

1. Enable stored invocation logs **only under `env.preview`**, using `observability.enabled: true` and `head_sampling_rate: 1` for this low-volume diagnostic trial. Redeploy and confirm a newly generated request is visible in the dashboard. Reconsider sampling if traffic grows; avoid logging credentials, raw provider bodies, or unnecessary request data. This configuration change has not been made yet.
2. Record a small, repeatable route matrix: homepage, search, metadata, declarations, measurements, and briefing evidence. Include minimist and a larger/scoped package. Keep AI disabled. Record sample count, versions, CPU/wall time, status/outcome, and first versus repeated requests; do not label a request cold without evidence.
3. Separate HTML rendering from API costs and determine whether overruns persist across repeated requests. Include a limited concurrency check after the sequential baseline, not an unbounded stress test.
4. Capture a CPU profile of the **built Worker locally**, with equivalent requests and data: start Wrangler preview, attach DevTools, record in the Profiler, issue the selected request, and stop recording. Use bottom-up function/self-time and garbage-collection views. Local measurements identify hotspots; their absolute timings are not interchangeable with Cloudflare production CPU numbers. See [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
5. Keep attributing remaining frontend CPU separately from evidence work. Homepage prerendering, comparison SSR reduction, unused per-file hashes, and response-header tracing are recorded in the optimization backlog, not included in this cutover. Do not use `Date.now()`/`performance.now()` around production code as a substitute for CPU profiling; Workers restrict timer advancement around I/O.
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
