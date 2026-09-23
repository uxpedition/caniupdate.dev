# Cloudflare deployment and durable briefing generation

**Date:** 2026-09-22  
**Status:** Approved design; milestone 1 implemented and verified locally, with independent spec/quality review passed. Later milestone implementation and production deployment require their own approval.  
**First implementation plan:** `docs/superpowers/plans/2026-09-22-cloudflare-compatibility.md`

## 1. Goal and decision record

Deploy this Nuxt application on Cloudflare while making AI generation shared, durable, and independent of browser connections. Preserve the current regeneration policy: SHA-256 of the bounded, model-visible evidence packet identifies a successful briefing. Identical evidence reuses the paid-for result indefinitely. Changed evidence permits a new result. No freshness window, package-pair-only cache key, or model/prompt-driven invalidation is introduced.

Decisions from the discussion:

- Cloudflare is the deployment target despite its local/production differences.
- Keep HTTP for requesting work and reading results; use hibernating Durable Object WebSockets for pending-job notifications, not browser status polling.
- Use Queues for background execution, Durable Objects for job coordination/subscribers, and D1 for successful briefing results.
- Preserve Nuxt HMR during ordinary development. Also run the actual production build under local `workerd`; a working Node development server is not deployment proof.
- Treat compatibility, durable generation, client cutover, and operational rollout as separate milestones, each with its own executable acceptance gate.
- Do not turn the throwaway spike into production code. Its debug endpoints, arbitrary WebSocket target override, counters, aliases, and fixture work are not application features.

The reliability algorithms and operational defaults below are proposed design decisions, not claims that the spike implemented them.

## 2. Evidence from the completed spike

Two DeepSeek V4.1 Flash agents investigated separate surfaces. The controller independently exercised HMR, browser proxying, local/remote job transport, and process-restart persistence.

| Surface | Observed result | Scope of proof |
| --- | --- | --- |
| Nuxt component HMR | Changed rendered text; unchanged browser sentinel and `performance.timeOrigin`; a connected diagnostic socket still exchanged messages | Nuxt dev, not production-runtime HMR |
| Browser HTTP and WebSocket proxy | Submission reached local Worker; socket received queued snapshot then completion | Required explicit path rewriting and a WebSocket bridge |
| Ten identical submissions | One SHA/job, one enqueue, one execution | Healthy concurrent HTTP submissions |
| Subscribers | Fan-out, reconnect, and late subscription delivered current/completed state | Local and deployed transport fixture |
| Evidence identity | Changed evidence created a new SHA; identical local/remote evidence produced identical SHA and deterministic result | Same serialization and hashing, not inference |
| Persistence | Restart with the same local state directory retained result and D1 row; resubmission did not execute again | Controlled full Wrangler process restart |
| Real Cloudflare deployment | Same transport scenario passed against a temporary Worker, Queue, SQLite-backed Durable Object, and D1 database | Backend fixture only; resources were subsequently deleted |
| Unmodified app build | Failed resolving optional `kerberos` from `proxy-agent-negotiate` | Real registry dependency graph is not Worker-ready |
| Diagnostic dependency bypass | Built, then failed local Worker startup with `Neon: unsupported Linux architecture:` | Native `libsql` module initialization is a second blocker; aliasing is not a fix |
| Dev stability | An unhandled `read ECONNRESET` was followed by a live process losing its listening port; restarting restored it | Root cause not established; do not attribute this conclusively to Cloudflare |

Baseline: Nuxt 4.5.2, Nitro **2.13.4**, Wrangler 4.136.2. The project uses H3 2 APIs with Nuxt's integration; do not substitute Nitro 3 examples based on the latest documentation URL. Installed Nitro 2.13.4 provides a Cloudflare dev binding proxy and places bindings in `event.context.cloudflare.env`.

The spike did **not** prove real AI-provider operation, forced Durable Object eviction/hibernation billing, queue autoscaling, regional failover, in-flight duplicate-delivery exclusion, or exactly-once billing. Its completion-only duplicate guard and nontransactional record-then-enqueue sequence are inadequate for production.

Optional raw evidence, not prerequisites for understanding this design: `/tmp/can-i-update-cf-dx-YUBo0n/{verdict,hmr-evidence,parity-evidence,restart-evidence}.json` and the `nuxt/spike-probe/` build logs. This section preserves the findings because `/tmp` is disposable.

## 3. Current code and invariants

### Request path

`server/api/package/[packageName]/compare/briefing.get.ts` resolves complete comparison facts, calls `getPackageBriefing`, and waits for inference. Evidence includes registry declarations, tarball inspection, OSV, Bundlephobia, and GitHub release notes. Declarations are SSR-prefetched independently; measurements and briefing are client-only.

### Existing protection

`server/utils/packageBriefing.ts` hashes `JSON.stringify(buildBriefingEvidence(input))`, looks up the persistent result before consulting provider configuration, and shares in-flight inference with a process-local Effect cache. `packageBriefingStore.ts` preserves the first successful result for an evidence hash. Failed store reads must prevent inference; failed writes must not be presented as durable success.

The persistent table is currently:

```sql
CREATE TABLE package_briefings (
  evidence_hash TEXT PRIMARY KEY NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Persisted results can contain legacy coverage bullets, so the existing `AvailablePackageBriefingSchema` remains the read decoder. Fresh-generation validation remains stricter.

### Contracts to preserve throughout the migration

1. Successful results have no TTL; reverting to older evidence reuses the old result.
2. API key, endpoint, model, and prompt changes do not invalidate a stored success.
3. Retrieval timestamps that are absent from the evidence packet cannot cause regeneration.
4. Evidence is collected and bounded server-side; the browser never supplies authoritative facts or an authoritative SHA.
5. The existing provider validation, citation rules, secret handling, response-size bounds, and 75-second inference deadline remain intact.
6. One fresh regeneration for invalid provider output is the existing maximum within that deadline. Queue retries must not silently multiply that allowance.
7. Facts continue to render independently of AI availability. No SSR inference, dependency execution, package installation, or tarball extraction to disk.
8. Global correctness must not depend on isolate-local Effect caches. They remain performance optimizations only.
9. Preserve already-generated local results during the storage migration; never delete `.data/briefings.db` or silently discard history.

## 4. Target topology and boundaries

```text
Browser
  ├─ declarations / measurements ───────────────> Nuxt Worker
  ├─ request briefing ──────────────────────────> Nuxt Worker
  │                                               │ collect + bound evidence
  │                                               │ calculate SHA
  │                                               ▼
  │                                         Briefing service Worker
  │                                               │
  │                          ┌────────────────────┼─────────────────────┐
  │                          ▼                    ▼                     ▼
  │                     D1 successes       Job DO per SHA          Cloudflare Queue
  │                                             │                     │
  └─ pending subscription ──> service Worker ─────┘                queue consumer
                                                 ◀── persist + commit ──┘
```

Use two application deployments at the end state: Nuxt for pages/evidence collection, and a small briefing service Worker exporting its fetch/queue handlers and Durable Object classes. Keep prompt/evidence/provider logic in shared server modules imported by those entrypoints; do not copy a second AI implementation into the Worker directory. This permits ordinary Nuxt HMR alongside the real local background runtime.

The service Worker exposes only the intended public subscription surface. Enqueue and coordinator control operations are internal service-binding calls in deployment, not unrestricted public URLs. During local development, bind the service to loopback and use an explicit local adapter; local configuration must not enable remote bindings.

For deployment, route the subscription URL directly to the briefing service Worker on the application's origin. Do not forward a WebSocket upgrade through Nitro's ordinary fetch-based proxy. Before client cutover, choose and verify the actual Cloudflare routing configuration for the deployment hostname; local routing must expose the same browser path. An explicit local WebSocket-capable proxy may be necessary. Its disconnect/error handling is an acceptance criterion, not optional polish.

### Ownership

| Component | Authority |
| --- | --- |
| Nuxt evidence collection | Resolve versions, gather evidence, create the exact bounded packet |
| D1 `package_briefings` | First validated successful result for each SHA |
| Job Durable Object | Immutable packet, generation attempt, dispatch/recovery state, execution lease, subscriber state/revision |
| Admission Durable Object | Shared attempt-budget reservations; not per-isolate counters |
| Queue | Delivery/retry scheduling, not deduplication or result authority |
| Queue consumer | Claim permitted execution, call provider, validate, persist result, commit coordinator state |
| Browser | Display status and subscribe; never decide whether a paid retry is allowed |

No KV lock, browser-created job identity, or in-memory-only ownership guard.

## 5. Identity and evidence collection

The success key stays exactly:

```ts
sha256(JSON.stringify(buildBriefingEvidence(input)))
```

Do not include a job id, time, prompt version, model, or provider credential in that hash. Preserve JSON serialization and ordering; a storage migration must not inadvertently change every key.

The initial HTTP request still performs evidence collection before it knows the hash. Queueing inference does not make that collection free or instantaneous. Existing evidence caches retain their current semantics. A separate shared evidence-cache project is out of scope.

The exact packet is stored durably with the job before enqueue acknowledgment. The consumer uses that packet, not a new collection that might have a different hash. Queue messages contain the hash and generation identifier; they need not duplicate the evidence or carry secrets. The service recomputes/validates packet identity at its internal boundary.

A completed result is immutable. Old snapshots remain available and are never overwritten by a later model or an administrative retry.

## 6. Durable job lifecycle and failure handling

Public states are `queued`, `running`, `available`, and `unavailable`. Internal dispatch, lease, and recovery fields are separate from this presentation union.

### Admission and enqueue

1. Resolve evidence and hash. Read D1 before provider configuration/admission; return an existing validated success immediately.
2. Address one Job DO by that SHA. Concurrent requests observe or create the same job.
3. In one durable local transaction, record the immutable packet, generation id, pending-dispatch state, and recovery alarm before allowing a success acknowledgment.
4. Dispatch outside the transaction. On success, record dispatch acknowledgment; a recovery alarm re-dispatches unacknowledged work. A crash after queue acceptance but before that record can produce duplicates, which the execution lease handles.
5. Do not acknowledge a newly accepted job whose durable record/alarm write failed. A queued response means recoverable work exists, not merely that an in-memory promise was scheduled.

### Execution and commit

1. Consumer addresses the job by SHA and generation id. Completed or obsolete generations are acknowledged without inference.
2. Claim an execution lease atomically. An unexpired running lease rejects overlapping execution. A queue redelivery while a valid owner is working must not create a second inference.
3. Check D1 again before provider work. A previous consumer may have persisted a success before losing its completion acknowledgment.
4. Reserve a global attempt-budget unit immediately before **each actual provider request**, including the existing invalid-output retry. Record reservation ids durably; duplicate delivery cannot reserve/spend the same logical attempt twice.
5. Run the existing bounded provider pipeline. Lease expiry must exceed the provider deadline plus persistence margin; use fencing tokens for completion so an obsolete owner cannot overwrite current state.
6. Persist the validated result to D1 with first-writer-wins semantics. Read back the canonical stored winner.
7. Commit `available` and its result reference/revision to the Job DO; notify subscribers only after that durable commit. Then acknowledge the queue message.
8. If the consumer dies after D1 persistence, recovery reconciles from D1 without another model call.

A database/queue outage must fail closed for new paid work. Do not replace unavailable persistence with a memory-only success cache.

### Ambiguous provider outcomes

Exactly-once billing is not promised. A timeout/crash after the provider accepted a request but before a durable result exists is ambiguous unless that provider supports an appropriate idempotency contract.

Proposed safe policy: mark such a generation unavailable with an internal `outcome-unknown` reason; do not let automatic queue redelivery spend again. An explicit administrative retry may start a fenced new generation, still subject to the budget. No public force-regenerate flag is exposed. Future provider idempotency support must be verified, not inferred from a request/session header.

For definite terminal failures, record a sanitized reason and a server-enforced retry eligibility time. Proposed cooldown: five minutes. A later user submission may admit a new generation after that time; socket reconnects and GET reads cannot do so. Configuration errors require configuration repair, not a retry loop. Preserve the existing rule against automatically retrying provider HTTP/transport failures inside one generation.

Infrastructure delivery retries are bounded and terminate visibly; recovery must not leave the UI permanently queued. The detailed generation plan must specify and test queue retry limits, lease duration, alarms, and exhausted-delivery reconciliation before implementation starts. These values are deliberately not guessed into the compatibility plan.

## 7. Spending controls and security

Deduplicating one SHA does not stop a client from requesting many distinct comparisons.

- Require a configured positive daily provider-attempt limit before enabling new generation; missing or invalid budget configuration disables inference, not cached reads. Budget days are UTC calendar days; reservations retain their day and logical attempt identity across retries and midnight.
- Make admission reservations durable and global. Worker-local rate-limit counters are insufficient for a hard shared cap.
- Bound queue consumer concurrency separately from the daily budget. Concurrency limits smooth work; they do not cap total spending.
- Apply request-abuse protection to work submission, not to every cached read or WebSocket heartbeat. Exact rate thresholds belong to the operational plan and require load/usage evidence.
- Never accept provider URLs, credentials, arbitrary socket proxy targets, or evidence packets from public requests.
- Keep provider credentials only in server-side secrets. Do not include them, provider response bodies, or raw error objects in queue messages, logs, D1 rows, or WebSocket frames.
- Compare/subscription reads concern public package data, but that does not make internal enqueue/admin interfaces public.
- Validate subscription origin and cap connections/message sizes. No client message may create/retry a generation.

Do not mistake Cloudflare's free-tier limits for an AI spending cap. If the free CPU allowance cannot support the real evidence path, report measured requirements rather than relying on occasional limit grace.

## 8. HTTP and client contract direction

Milestone 1 keeps the **existing GET briefing endpoint unchanged**. The following belongs to the later atomic endpoint/client cutover:

- `POST /api/package/{encodedPackageName}/compare/briefing?from=...&to=...`: validate the same package/version inputs, collect evidence, and request shared work. Return `200` for a cached available result; return `202` with the SHA/job reference, status revision, and subscription URL for durable queued/running work. Definite unavailable states include sanitized reason/retry eligibility. Admission rejection is explicit, not a fictitious queued job.
- `GET /api/briefings/{evidenceHash}`: read a known result/job without generation or evidence collection. This is for recovery, links, and diagnostic reads, not periodic browser polling.
- `/api/briefings/{evidenceHash}/events`: WebSocket subscription. On connect, send a current durable snapshot/revision before live updates. This closes the completion-before-subscribe race.

Client rules:

1. Only initiate work client-side after declarations resolve exact versions; never during SSR.
2. Cached response: render without opening a socket.
3. Pending response: show the actual state and subscribe. Do not invent queue positions or percentage completion.
4. Persisted monotonic revisions let the client ignore stale/duplicate events. Reconnect with bounded backoff and obtain current state; reconnect does not submit work again.
5. Changing comparisons releases that view's socket and ignores stale results; it does not cancel shared generation.
6. On available/unavailable terminal state, update the existing Vue Query entry and close the subscription.
7. Preserve the existing citation/anchor rendering and independent declarations/measurement failures.

The detailed client plan will define a shared typed union in `shared/briefing.defs.ts` and migrate every caller together. Remove the synchronous generation GET path then; do not leave a hidden legacy route that bypasses the queue.

## 9. Local development and production verification

### Ordinary development

Use the pinned Nuxt/Nitro development server with local D1 bindings. In the durable-generation milestone, start the briefing service under Wrangler alongside it. A single supervised development command may own both processes, but must report failed readiness and terminate both children on exit. Keep local state at a fixed documented path; do not accidentally reset it between restarts.

Local development must not require Cloudflare login or production resources. Explicitly disable remote bindings. Provider calls are still real if a developer supplies real credentials; the default verification flow uses an isolated fixture provider and local-only state.

### Local production preview

Build the real Nuxt app with the Cloudflare preset, then start the built Worker through Wrangler, with the same compatibility date, bindings, and migrations as development. Do not count `nuxt dev`, a fixture Worker, or a build that never boots as this gate.

Exercise search, scoped package metadata, declarations, measurements, tarball decompression/integrity, SSR/hydration, and briefing reads/writes/provider validation. No native-module aliases, empty-module substitutions, silently unavailable tarballs, or false fallback results may make this gate pass.

### Deployed preview

Run the equivalent scenario in a separate Cloudflare environment after the relevant local gates pass. Use separate databases, queues, DO namespaces, and secrets. Report payload/runtime differences rather than claiming perfect emulation. Actual free-plan CPU, subrequest, memory, hibernation, and regional behaviour require deployed observation.

The first milestone stops at local compatibility; the full app is not publicly rolled out while its briefing endpoint still performs synchronous inference.

## 10. Milestone roadmap

| Milestone | Deliverable | Exit gate | Does not include |
| --- | --- | --- | --- |
| M1 — compatibility | Public npm fetch transport; D1 success store; existing result import; reproducible local dev/production preview | Real application routes and D1/provider path work in local `workerd`; HMR remains usable | Queues, DOs, WebSockets, public production rollout |
| M2 — durable generation | Internal briefing service, job coordination, dispatch recovery, execution leases, bounded spending/retries | Failure-window and concurrent-delivery scenarios exercise the real local services; no lost jobs or unchecked inference loops | Client cutover until the protocol is ready |
| M3 — client/API cutover | Typed submission/read/subscription protocol, WebSocket routing, Vue Query/UI migration | Actual compare page survives refresh/reconnect and retains progressive facts; obsolete generation path removed | Production launch without operational gates |
| M4 — rollout | Isolated preview, migrations/data import, resource limits, failure visibility, rollback and deployment workflow | Local/deployed acceptance matrix passes; remaining platform limits accepted explicitly | Unmeasured promises of unlimited free hosting or exactly-once billing |

Each milestone receives a separate detailed plan after its prerequisites have been verified. Only M1 is detailed now. M1 can be reviewed and merged independently but is not the production launch.

## 11. M1 binding constraints

These exact constraints are copied into its implementation plan:

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

## 12. Review and execution records

Plans live in `docs/superpowers/plans/`; this design is the shared source of architectural contracts. Execution uses a per-plan Superpowers ledger recording completed tasks, verification, decisions, and blockers. A future session reads the spec, its plan, and its ledger rather than reconstructing decisions from chat or the deleted remote spike.

DeepSeek V4.1 can implement scoped tasks; independent review checks spec compliance and quality. Shared-file cutovers are serialized. Final review includes cross-task behaviour and the real runtime gate. A compiling scaffold is not milestone completion.

No runtime behaviour or existing documentation contract is superseded by this draft until the applicable implementation is accepted. In particular, the existing progressive-comparison design remains authoritative for rendering; only the later briefing client cutover changes that document's synchronous-briefing exception.

### M1 runtime findings

Actual application verification required two narrow compatibility changes: reject redirects using `manual` plus zero-follow/non-2xx handling because `workerd` does not implement `redirect: 'error'`; and patch the pinned Effect Cache's pending waiters to bridge their Exit through a native promise so each HTTP request retains its own runtime context. Do not disable cross-request promise safety. Real concurrent application requests and a red/green workerd regression cover the cache fix; real tarball inspection and a provider redirect fixture cover the transport change. Neither change introduces a fallback store, hidden unavailable result, queue, or new client protocol.

The TypeScript facade was replaced by the same underlying compiler, pinned directly at 6.0.3, after a live Vue diagnostic probe demonstrated a broken cold-start watcher. These findings and the implementation-specific type boundaries are recorded in the M1 plan. The §11 storage wording now explicitly preserves §3's distinction between preventing inference after a failed read and refusing durable success after a failed write.

## 13. References

- [Nitro 2 Cloudflare deployment and dev preset](https://v2.nitro.build/deploy/providers/cloudflare)
- [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/)
- [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Queue local development and concurrency limitation](https://developers.cloudflare.com/queues/configuration/local-development/)
- [Queue at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Durable Object WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Author self-review

- Evidence is separated from proposed production guarantees; no exactly-once or full-app deployment claim.
- SHA-based regeneration, first-success preservation, server-only evidence, and progressive rendering are retained.
- The enqueue crash window, running-delivery overlap, result/notification ordering, ambiguous provider outcome, and distinct-key spending abuse each have an explicit design rule.
- The M1 boundary is coherent: synchronous API remains internal/local while compatibility is established; no public paid-inference launch is implied.
- Later numeric deployment/lease decisions are delegated to named milestone plans, not represented as executable M1 tasks.
