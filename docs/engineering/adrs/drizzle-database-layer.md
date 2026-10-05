# Drizzle database layer

**Decision (2026-10-04):** Adopt Drizzle for typed query construction in D1 briefing storage, Durable Object SQLite evidence storage, and the offline briefing exporter. Keep Wrangler as the only D1 migration applier. Reset the local and preview D1 databases and restart migration history at the pre-production cutover, as explicitly approved by the user.

**Status:** Accepted; implementation and local cutover verified, preview cutover blocked on maintenance/quiescence. Approval is not reset or rollout evidence.

**Amendment (2026-10-05):** The user approved Drizzle ownership of evidence-table/index initialization too, superseding the handwritten constructor-DDL exception. Evidence-only Kit history is bundled separately and applied synchronously by the public DO migrator; the initial generated bootstrap is idempotent for existing objects, and subsequent history is strict. A version-specific two-line ORM patch preserves migration SQL causes without changing dependency versions. DO/Queue state is not reset.

## Why

The current stores coordinate handwritten SQL, column projections, and row types across three execution environments. Declared SQLite schemas and typed queries reduce that coordination while retaining each runtime's execution model. The feasibility spike demonstrated D1 batch queries, synchronous Durable Object queries, and Node SQLite query construction without requiring a new application storage abstraction.

Keeping raw SQL avoids dependency and migration-tooling costs but leaves schema/query typing manually coordinated. Hand-maintained migrations remain possible, but generated DDL is the chosen design. A typed-query-builder alternative would require further driver assessment or execution glue for D1 batching and synchronous DO transactions.

The user confirmed that the application is not yet deployed to production and approved resetting local and preview databases. Preserving the old `0001_package_briefings.sql` history or establishing a non-destructive baseline is therefore not a cutover requirement. After this scoped reset, applied migrations remain append-only under the release policy.

## Costs and limits

- Preserve public store APIs, tagged errors and causes, D1 first-writer-wins batching, synchronous DO transaction boundaries, evidence validation/chunking, and stored JSON contracts. Drizzle replaces query construction, not domain validation.
- Keep Effect Schema independent of Drizzle. Generate DO table/index DDL from the evidence schema and apply it through the synchronous Drizzle DO migrator; retain deliberate test fault-injection SQL. The exporter executes Drizzle-generated SQL through `DatabaseSync.iterate()` rather than buffering all rows.
- Keep briefing and evidence schema modules outside browser bundles. Only the briefing schema generates Wrangler-applied D1 migrations; DO schema initialization retains its separate lifecycle.
- Exact-pin and verify the installed ORM/Kit pair. The tested stable ORM lacked the Node SQLite adapter; the runtime spike used `1.0.0-rc.5-ab785fc`. This is evidence, not a guarantee for other versions. Mirror generated migration SQL into Wrangler's flat migration directory and verify ordering, drift, and statement splitting.
- Verify generated schema metadata. In the tested RC, column-level primary-key declarations omitted explicit `NOT NULL`; a table-level declaration generated matching briefing-table metadata.
- The minimal D1 worker comparison added approximately 38 KiB gzip. Actual Worker/Nuxt bundle impact and browser import boundaries must be measured during implementation; materially different costs require review before rollout.
- The spike did not establish DO rollback, atomic replacement, expiry/corruption behavior, full exporter streaming behavior, or application-wide type compatibility. Complete the RFC's acceptance checks before rollout rather than treating successful-path probes as full verification.
- The reset approval covers local and preview D1 databases only, not production, Durable Object state, or unrelated databases. Record exact targets, resolve stored-data retention/export requirements, and rehearse fresh initialization locally before the preview reset. Record execution separately from approval.

Reconsider the decision if the selected drivers cannot preserve existing behavior or the measured application costs materially outweigh the type-safety benefit.

## Implementation and rollout evidence

Observed implementation smoke: both `node scripts/smoke.ts` and `--preview` passed the actual three-runtime POST/socket/restart/D1-reuse/reconnect path with a loopback fixture and no second provider request. Disposable Wrangler state applied the initial history and a real generated three-statement follow-on migration, with matching metadata/order and no pending migrations. The exporter streamed 7,039 validated compact/pretty snapshots (536,906,876 JSON bytes) under a 128-MiB old-space cap; restored hashes/JSON/timestamps matched exactly and source SHA-256 was unchanged. Exporter-process peak RSS was 214,744 KiB, measured with native `process.resourceUsage()` because GNU time was unavailable.

Same-origin production bundle measurements (`http://localhost:5273`):

| Runtime              | Baseline raw / gzip KiB | Drizzle raw / gzip KiB | Added raw / gzip KiB |
| -------------------- | ----------------------- | ---------------------- | -------------------- |
| Evidence Worker      | 1245.66 / 245.30        | 1444.39 / 283.35       | 198.73 / 38.05       |
| Briefing Worker      | 1233.51 / 243.46        | 1433.54 / 281.81       | 200.03 / 38.35       |
| Nuxt frontend Worker | 1463.22 / 373.93        | 1465.95 / 374.58       | 2.73 / 0.65          |

The actual client output graph contained 14 chunks/379 module occurrences, with no Drizzle or database-schema module. Backend cost matches the approximately 38-KiB-gzip feasibility result; it does not materially change the approved decision. Final verification passed: 49 test files/413 tests, root and both Worker type checks, focused D1/DO/Node constructor/result anti-`any` probes, migration drift check and formatting. Lint retained only the 12 pre-existing warnings. The 21 real-workerd cache cases include synchronous replacement/cleanup rollback, coalescing, corruption, serialization and SQL failures; Worker/Queue/socket and exporter regressions also passed.

**Initialization amendment verification (2026-10-05):** Full regression run passed 50 files/432 tests; the 24 actual-workerd cache cases include populated legacy adoption, persisted reopen, atomic bootstrap failure, and the actual SQL-cause regression that failed with the unpatched SDK and passed with the committed patch. A clean frozen install reproduced ESM/CJS cause preservation and rollback with unchanged dependency resolutions. A real Kit-generated strict follow-on applied once in disposable persisted workerd state, preserving cached JSON/metadata through another reopen. Both dev and built-preview POST/socket/restart/D1-reuse smoke paths passed from an isolated source copy with fixture-only credentials; operator settings and normal persistence were not used for these smoke runs.

The amended evidence Worker is 1452.87/285.56 KiB raw/gzip, +8.48/+2.21 KiB over the typed-query implementation. Its emitted graph includes the DO migrator and bundled JSON but no Kit, D1 schema or migration filesystem code; the existing `tar-stream` `fs.constants` shim is unchanged and is not a migration filesystem dependency. The actual client graph remains 14 chunks/379 module occurrences with no Drizzle/schema/history modules. Lint retains only 12 existing warnings. No remote deployment or D1/DO/Queue reset was performed for this amendment.

**Local (2026-10-05):** The user explicitly changed retention to discard old briefing rows. After stopping the original launcher and backing up its D1 subtree, verified implementation revision `bae6694` reset only `package_briefings` and its old migration history in `/home/adrian/projects/can-i-npm-update/.wrangler/state`. Wrangler applied `20261004204918_lovely_nomad.sql`; observed row count is zero, primary-key/nullability/default/index metadata matches, and no migrations remain pending. The verified worktree launcher restarted against that exact persistence path with the existing operator settings; actual frontend `/api/health` returned `200 {"status":"ok"}`. No rows were restored, no new provider call was submitted for this verification, and DO/Queue state was not reset. The original `main` launcher remains stopped; do not restart it on the new history.

**Preview:** No new deployment, backup/reset, queue pause or state mutation. D1 identity matches the approved target. Authorized existing-preview health returned `200 {"status":"ok"}`; unauthenticated frontend redirects to Access. Management app-list queries expose zero applications even with pagination and audience filters, so the frontend maintenance rule cannot be targeted. Queue realtime backlog is zero, but complete namespace pagination found 14 persisted `BriefingJob` objects whose KV job states are not inspectable through available APIs. Missing acceptance exclusion and authoritative terminal-job observation block destructive cutover; a fixed wait or zero backlog is insufficient. An operator must supply the actual manageable Access application and verifiable quiescence (or obtain separately reviewed control/risk approval). Production remains untouched.

Raw verification/review artifacts are retained privately in the isolated maintainer worktree under `.superpowers/sdd/2026-10-04-drizzle-database-layer/`; this is not an artifact publisher or evidence available in another clone. The [cutover runbook](../ops/releases-and-recovery.md#one-time-drizzle-adoption-cutover) remains executable only after its prerequisites are met.

## Artifacts

- [RFC 0001: proposal, feasibility findings, and implementation acceptance checks](../rfcs/0001-drizzle-database-layer.md).
- [Database and stored-data release policy](../ops/releases-and-recovery.md#database-and-stored-data-changes); the user-approved local/preview reset is a scoped exception.
- Current implementations: [D1 briefing store](../../../server/comparison/briefing/store.ts), [DO evidence store](../../../workers/evidence/store.ts), and [offline exporter](../../../scripts/export-briefings.ts).
