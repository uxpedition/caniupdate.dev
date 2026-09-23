# Cloudflare handoff

**Updated:** 2026-09-23. Compatibility and an AI-disabled remote preview are implemented. The next task is CPU investigation, not enabling paid inference or declaring production readiness. This document is the current handoff; the original M1 plan is an execution history and the durable-generation spec describes later architecture.

## Completed work

| Commit | Delivered |
| --- | --- |
| `ad52e96` | Public Effect HTTP npm transport; request-bound D1 permanent briefing store; read-only legacy SQLite exporter; local migrations, Nuxt development, and built-Worker preview |
| `dda154a` | Removed the rejected Effect patch, process-local provider caches, and inference coalescing; retained request-local manifest sharing and durable D1 reuse |
| `20be28b` | Fixed Firefox startup by disabling Nuxt's entry-import-map optimization; SSR streaming remains enabled |
| `5cda662` | Added an isolated remote `preview` environment and deployed it with a separate D1 database and no AI credentials |

The Firefox failure was real: HTTP module-preload headers interacted with the `#entry` import map, leaving server-rendered HTML visible but non-interactive. A clean Firefox session produced `NUXT_E1005`, an unresolved `#entry`, and no API requests. Direct chunk imports restored search and comparison hydration. API-only checks had missed this; future verification must exercise actual browser interactions.

### Contracts retained

- A successful briefing is permanent and keyed by SHA-256 of the bounded model-visible evidence packet. No TTL or model, prompt, endpoint, or credential invalidation.
- D1 is read before provider configuration/inference. Failed reads fail closed; failed writes cannot be reported as durable success. A write failure after generation cannot undo its cost.
- Concurrent successful inserts return the first stored winner, not each caller's independently generated text.
- No cross-request evidence cache or inference coalescing remains. Each comparison side shares its manifest only within that request. Concurrent D1 misses can independently incur provider costs, even in one isolate.
- Provider URL/credential/redirect checks, schema validation, archive integrity and resource bounds, existing deadlines, and partial-result semantics remain intact. Do not reintroduce the Effect patch or shared Effect Cache to improve performance.
- The legacy SQLite source was not automatically imported, modified, or deleted. Its read-only exporter remains available for an explicit migration.

### Verification already observed

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
- Only `ASSETS` and `BRIEFINGS_DB` were deployed as bindings. No AI credentials, custom domain, KV, Queues, Durable Objects, or paid-plan upgrade were added. This is a public trial with inference disabled, not an unrestricted paid-inference launch.
- The restricted token cannot read billing subscriptions; the deployment did not independently verify the account's billing plan. No billing changes were requested or performed.
- The default Wrangler environment remains local-only. `nub run --node preview` starts the local Worker; it does not select the remote environment. Remote commands require `--env preview`, and migrations additionally require `--remote`.
- Deployment credentials remain in the user's `~/.config/can-i-update/cloudflare.env`, outside the repository. Never print the token, copy it into application configuration, or replace another project's Wrangler OAuth login.
- Local dev and built preview share `.wrangler/state`; do not run them concurrently or delete that directory as test cleanup. The active preview and diagnostic evidence remain in the feature worktree. A different checkout has a different local state directory; merging does not migrate local data.

See the [README deployment commands](../README.md#remote-preview-trial). Stop a preview before rebuilding the output it serves. Keep the feature worktree until its running process, local data, and ignored evidence have been deliberately transferred or retired; do not force-remove it after merging.

## Debug now: CPU usage and visibility

### What was measured

The following are individual samples from Cloudflare's live `wrangler tail --format json` stream, not averages, percentiles, or a load test:

| Request | CPU time | Wall time | Result |
| --- | --- | --- | --- |
| Homepage `/` | 91 ms | 96 ms | 200, `ok`, no exceptions |
| Search for minimist | 31 ms | 474 ms | 200, `ok`, no exceptions |
| Minimist comparison HTML | 43 ms | 280 ms | 200, `ok`, no exceptions |
| Minimist measurements API | 35 ms | 1,051 ms | 200, `ok`, no exceptions |
| Minimist briefing API | 140 ms | 1,040 ms | 200, `ok`, no exceptions |

The comparison was `1.2.0...1.2.8`. A later briefing sample used 22 ms CPU; do not infer a proven cold/warm distinction from request order alone. Network waiting is excluded from CPU time. The briefing route still collects evidence before `getPackageBriefing` checks D1 and provider configuration, so its CPU cost exists even with AI disabled.

These samples exceed the [documented Workers Free 10 ms CPU allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Cloudflare permits some occasional overruns. We observed successful over-allowance requests, **not an exceeded-CPU error**, and have not established reliable sustained Free-tier operation.

### Why the dashboard has no stored logs

Stored Workers Logs are **not enabled** in the preview configuration. Live tail worked independently while a diagnostic connection was open; that connection has been stopped. The historical live stream does not become dashboard log history retroactively.

[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) currently includes 200,000 events/day and three-day retention on Free. Invocation records expose request-level CPU, wall time, status, and outcome; they do not identify the expensive functions.

### Next investigation, in order

1. Enable stored invocation logs **only under `env.preview`**, using `observability.enabled: true` and `head_sampling_rate: 1` for this low-volume diagnostic trial. Redeploy and confirm a newly generated request is visible in the dashboard. Reconsider sampling if traffic grows; avoid logging credentials, raw provider bodies, or unnecessary request data. This configuration change has not been made yet.
2. Record a small, repeatable route matrix: homepage, search, metadata, declarations, measurements, and briefing evidence. Include minimist and a larger/scoped package. Keep AI disabled. Record sample count, versions, CPU/wall time, status/outcome, and first versus repeated requests; do not label a request cold without evidence.
3. Separate HTML rendering from API costs and determine whether overruns persist across repeated requests. Include a limited concurrency check after the sequential baseline, not an unbounded stress test.
4. Capture a CPU profile of the **built Worker locally**, with equivalent requests and data: start Wrangler preview, attach DevTools, record in the Profiler, issue the selected request, and stop recording. Use bottom-up function/self-time and garbage-collection views. Local measurements identify hotspots; their absolute timings are not interchangeable with Cloudflare production CPU numbers. See [Cloudflare CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
5. Attribute time before choosing an optimization. Nuxt/Vue rendering, lazy module/schema initialization, JSON decoding, integrity hashing, archive inspection, and repeated evidence work are **hypotheses, not measured root causes**. Do not use `Date.now()`/`performance.now()` around production code as a substitute for CPU profiling; Workers restrict timer advancement around I/O.
6. Propose the smallest evidence-backed change, preserve the storage/security contracts above, and compare before/after profiles and deployed request samples. Repeat Firefox and Chromium workflows. If Free remains unsuitable, report that and obtain a hosting decision rather than silently upgrading or weakening evidence collection.

**Investigation exit gate:** reproducible request-level observations, identified expensive functions, a documented hosting/performance decision, and a verified before/after result if code changes. Logging alone is not the fix. No caching design or paid plan is approved by this handoff.

## What follows after CPU investigation

1. **Evidence caching, only if justified:** choose a separately approved Cloudflare-appropriate design. Do not restore isolate-local Effect caches. Specify freshness, invalidation, bounds, and failure behavior; keep permanent successful briefings separate from mutable provider evidence.
2. **M2 — durable generation:** implement job coordination and immutable packet storage, Queue dispatch/recovery, execution leases, bounded attempts/spending, and D1 reconciliation. D1's first-writer-wins result alone does not prevent duplicate provider charges. Verify crash windows and duplicate delivery before client cutover.
3. **M3 — client/API cutover:** replace synchronous generation with typed submission/read endpoints and hibernating Durable Object WebSocket notifications. Preserve progressive facts, citations, reconnection behavior, and no browser status polling; remove the old generation path only after end-to-end verification.
4. **M4 — production readiness:** extend this preview trial into operational gates: access/abuse protection, approved budgets and credentials, runtime/resource limits, migrations and explicit legacy-data import, failure visibility, rollback, and deployment procedures. The current preview is only part of M4's evidence, not completion of M4. Do not publicly enable paid inference before spend/access controls.

Later milestones need their own implementation plans and approval. Their contracts and failure scenarios are in the [durable briefing design](superpowers/specs/2026-09-22-cloudflare-briefing-migration-design.md); the [M1 implementation plan](superpowers/plans/2026-09-22-cloudflare-compatibility.md) is historical, including explicitly superseded cache/patch steps.

## Evidence and resumption

Durable source-controlled evidence is summarized here and in the README. More detailed local artifacts remain under `.superpowers/sdd/2026-09-22-cloudflare-compatibility/` in the feature worktree and are intentionally ignored:

- `worker-uncached-concurrent.json`, `worker-uncached-reuse.json`, `worker-uncached-restart.json`: unpatched concurrency and durable-result reuse.
- `firefox-preview-hydration.json`: Firefox failure, controlled preload-header experiment, and repaired browser flow.
- `remote-preview-deployment.json`: deployment/migration output, browser checks, bindings/database observations, and CPU samples.

Do not rely on those ignored files being available in another clone. Begin the next session with this handoff, the README commands, the target account/environment, and fresh observations. The next approved work should be the CPU/logging investigation, not an assumption that the successful smoke established production readiness.
