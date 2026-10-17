# Drizzle database layer

**Decision (2026-10-04):** Adopt Drizzle to build typed queries for D1 briefing storage, Durable Object SQLite evidence storage, and the offline briefing exporter. Keep Wrangler as the only tool that applies D1 migrations.

At the pre-production cutover, reset local and preview D1 databases and restart migration history. The user explicitly approved this reset.

**Status:** Accepted; implementation and local cutover verified. Stage cutover is blocked until maintenance controls are available and work has stopped (quiescence). Approval is not evidence of a reset or rollout.

**Terminology:** Historical decisions and rollout observations below use “preview”, the hosted environment's former name. Current operations use `stage` and Wrangler `--env stage`. Physical resource names and IDs are unchanged; see the [deployment naming procedure](../ops/deployment.md#migrating-logical-environment-selectors-and-gitlab-scopes). Renaming does not execute or authorize the blocked database cutover.

**Exporter retirement (2026-10-09):** The offline briefing exporter and its legacy-import procedure were removed because that transfer workflow is no longer needed. The exporter decisions and checks below describe history, not a tool available today.

**Amendment (2026-10-05):** The user also approved Drizzle ownership of evidence-table/index initialization. This replaces the exception for handwritten constructor DDL (SQL that defines tables and indexes).

Evidence-only Kit history is bundled separately and applied synchronously by the public Durable Object (DO) migrator. The initial generated bootstrap can safely run against existing objects; later history is strict. A version-specific, two-line ORM patch preserves the underlying migration SQL errors without changing dependency versions. DO/Queue state is not reset.

## Why

The stores coordinated handwritten SQL, selected columns, and row types across three execution environments. Declaring SQLite schemas and using typed queries reduces that manual coordination. Each runtime keeps its execution model.

The feasibility experiment demonstrated D1 batch queries, synchronous Durable Object queries, and Node SQLite query construction. It did not need a new application storage abstraction.

Keeping raw SQL avoids dependency and migration-tooling costs, but leaves schema and query types to be coordinated by hand. Hand-maintained migrations remain possible; generated DDL is the chosen design.

The earlier alternative assessment found no available Kysely community driver covering both D1 batching and synchronous DO transactions. Drizzle's first-party adapters avoided custom execution code. This was an assessment at adoption time, not a claim about current driver availability.

The user confirmed that the application was not yet deployed to production and approved local and preview resets. The cutover therefore need not preserve `0001_package_briefings.sql` or establish a non-destructive baseline. After this scoped reset, applied migrations remain append-only under the release policy.

## Costs and limits

- Preserve public store APIs, tagged errors and their causes, D1 first-writer-wins batching, and synchronous DO transaction boundaries. Keep evidence validation/chunking and stored JSON contracts. Drizzle replaces query construction, not domain validation.
- Keep Effect Schema independent of Drizzle. Generate DO table/index DDL from the evidence schema and apply it through the synchronous Drizzle DO migrator. Retain deliberate SQL for test fault injection. The exporter executes Drizzle-generated SQL through `DatabaseSync.iterate()` rather than buffering all rows.
- Keep briefing and evidence schema modules out of browser bundles. Only the briefing schema generates Wrangler-applied D1 migrations. DO schema initialization has its own lifecycle.
- Pin exact ORM/Kit versions and verify the installed pair. The tested stable ORM lacked the Node SQLite adapter; the runtime experiment used `1.0.0-rc.5-ab785fc`. That result does not guarantee other versions work. Mirror generated SQL into Wrangler's flat migration directory. Verify ordering, drift, and statement splitting.
- Check generated schema metadata. In the tested release candidate (RC), column-level primary-key declarations omitted explicit `NOT NULL`. A table-level declaration generated matching briefing-table metadata.
- The minimal D1 Worker comparison added about 38 KiB gzip. Measure actual Worker/Nuxt bundle cost and browser import boundaries during implementation. Review materially different costs before rollout.
- The experiment did not prove DO rollback, atomic replacement, expiry/corruption behavior, full exporter streaming, or application-wide type compatibility. The [verification requirements](#verification-requirements) governed adoption. Successful-path probes alone were not rollout evidence.
- Reset approval covers local and stage D1 only, not production, Durable Object state, or unrelated databases. Record exact targets and resolve retention/export needs. Rehearse fresh initialization locally before the stage reset. Record execution separately from approval.

Reconsider the decision if the selected drivers cannot preserve existing behavior or the measured application costs materially outweigh the type-safety benefit.

## Verification requirements

The adoption review required these checks, separate from approval to reset databases:

1. Verify the exact installed ORM/Kit pair and full application type compatibility, without new casts or explicit `any`.
2. Compare generated table/index metadata, including primary-key nullability and defaults. Verify migration ordering, mirrors, and statement splitting.
3. Exercise real D1 competing writers, misses, and failures while preserving error tags and causes.
4. Exercise real DO atomic chunk replacement, rollback, expiry cleanup, ordering, and corruption checks. Keep operations synchronous and preserve transaction boundaries.
5. Prove that generated DO history adopts populated storage without data loss, survives reopen without replay, and preserves migration failure causes.
6. Measure actual Worker/Nuxt bundle changes and check that schema/driver imports stay out of browser bundles. Return for review if costs materially change the tradeoff.
7. Record exact reset targets and retention needs, rehearse fresh initialization, then verify migration records and store behavior. Production and DO state remain outside reset approval.

The now-retired exporter also had to preserve stored JSON and escaped output, stream through `DatabaseSync.iterate()`, and use zero query bindings. These are historical acceptance checks, not a requirement to restore the exporter.

The rollout evidence below records completed checks. The [cutover runbook](../ops/releases-and-recovery.md#one-time-drizzle-adoption-cutover) retains the remaining stage prerequisites.

## Implementation and rollout evidence

**Observed implementation smoke:** Both `node scripts/smoke.ts` and `--preview` passed the actual three-runtime POST/socket/restart/D1-reuse/reconnect path. They used a loopback fixture and made no second provider request.

Disposable Wrangler state applied the initial history and a real generated three-statement follow-on migration. Metadata and order matched; no migrations were pending.

The exporter streamed 7,039 validated compact/pretty snapshots (536,906,876 JSON bytes) under a 128-MiB old-space cap. Restored hashes, JSON, and timestamps matched exactly; the source SHA-256 was unchanged. Exporter-process peak RSS (resident memory) was 214,744 KiB. It was measured with native `process.resourceUsage()` because GNU time was unavailable.

Same-origin production bundle measurements (`http://localhost:5273`):

| Runtime              | Baseline raw / gzip KiB | Drizzle raw / gzip KiB | Added raw / gzip KiB |
| -------------------- | ----------------------- | ---------------------- | -------------------- |
| Evidence Worker      | 1245.66 / 245.30        | 1444.39 / 283.35       | 198.73 / 38.05       |
| Briefing Worker      | 1233.51 / 243.46        | 1433.54 / 281.81       | 200.03 / 38.35       |
| Nuxt frontend Worker | 1463.22 / 373.93        | 1465.95 / 374.58       | 2.73 / 0.65          |

The actual client output graph contained 14 chunks/379 module occurrences, with no Drizzle or database-schema module. Backend cost matched the roughly 38-KiB-gzip feasibility result. It did not materially change the approved decision.

Final verification passed: 49 test files/413 tests, root and both Worker type checks, focused D1/DO/Node constructor/result anti-`any` probes, migration drift check, and formatting. Lint retained only the 12 pre-existing warnings.

The 21 real-workerd cache cases covered synchronous replacement/cleanup rollback, coalescing (sharing concurrent work), corruption, serialization, and SQL failures. Worker/Queue/socket and exporter regressions also passed.

**Initialization amendment verification (2026-10-05):** The full regression run passed 50 files/432 tests. The 24 actual-workerd cache cases included adoption of populated legacy storage, persisted reopen, and atomic bootstrap failure. They also included the SQL-cause regression that failed with the unpatched SDK and passed with the committed patch.

A clean frozen install reproduced ESM/CJS cause preservation and rollback, with unchanged dependency resolutions. A real Kit-generated strict follow-on migration applied once in disposable persisted workerd state. Cached JSON/metadata survived another reopen.

Both dev and built-preview POST/socket/restart/D1-reuse smoke paths passed from an isolated source copy with fixture-only credentials. These runs did not use operator settings or normal persistence.

The amended evidence Worker measured 1452.87/285.56 KiB raw/gzip, +8.48/+2.21 KiB over the typed-query implementation. Its emitted graph included the DO migrator and bundled JSON, but no Kit, D1 schema, or migration filesystem code. The existing `tar-stream` `fs.constants` shim was unchanged; it is not a migration filesystem dependency.

The actual client graph remained 14 chunks/379 module occurrences, with no Drizzle/schema/history modules. Lint retained only 12 existing warnings. This amendment involved no remote deployment or D1/DO/Queue reset.

**Local (2026-10-05):** The user explicitly changed retention to discard old briefing rows. The original launcher was stopped and its D1 subtree backed up. Verified implementation revision `bae6694` then reset only `package_briefings` and its old migration history in `/home/adrian/projects/can-i-npm-update/.wrangler/state`.

Wrangler applied `20261004204918_lovely_nomad.sql`. The observed row count was zero. Primary-key/nullability/default/index metadata matched, and no migrations remained pending.

The verified worktree launcher restarted against that exact persistence path with the existing operator settings. The actual frontend `/api/health` returned `200 {"status":"ok"}`. No rows were restored, no new provider call was submitted for this check, and DO/Queue state was not reset.

The original `main` launcher remains stopped. Do not restart it on the new history.

**Preview:** No new deployment, backup/reset, queue pause, or state mutation occurred. D1 identity matched the approved target. Authorized existing-preview health returned `200 {"status":"ok"}`; the unauthenticated frontend redirected to Access.

Management app-list queries exposed zero applications, even with pagination and audience filters. The frontend maintenance rule therefore could not be targeted. Queue realtime backlog was zero, but complete namespace pagination found 14 persisted `BriefingJob` objects. Their KV job states could not be inspected through available APIs.

The destructive cutover is blocked until new work can be excluded and all jobs can be verified as terminal. A fixed wait or zero backlog is insufficient. An operator must supply the actual manageable Access application and verifiable quiescence, or obtain separately reviewed control/risk approval. Production remains untouched.

Raw verification/review artifacts are kept privately in the isolated maintainer worktree under `.superpowers/sdd/2026-10-04-drizzle-database-layer/`. That path does not publish artifacts or make evidence available in another clone. The [cutover runbook](../ops/releases-and-recovery.md#one-time-drizzle-adoption-cutover) can run only after its prerequisites are met.

## Artifacts

- [Database and stored-data release policy](../ops/releases-and-recovery.md#database-and-stored-data-changes); the user-approved local/stage reset is a scoped exception.
- Current implementations: [D1 briefing store](../../../server/comparison/briefing/store.ts), [DO evidence store](../../../workers/evidence/store.ts).
