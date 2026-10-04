# RFC 0001: Drizzle database layer

**Status:** DISCUSSION — awaiting explicit user review  
**Date:** 2026-10-03  
**Decision:** None. This RFC does not approve implementation, dependency changes, or database operations.

An earlier discussion was recorded as approving a design. That is historical context, not a decision this RFC treats as accepted. This record is deliberately open because the old proposal's assumptions may no longer match the repository or operational policy.

## Summary

Adopt Drizzle as the typed query layer for the application's SQLite-backed data paths: Cloudflare D1 briefing storage, synchronous Durable Object (DO) evidence storage, and SQL construction in the offline briefing exporter. Keep Wrangler as the D1 migration applier. Declare table shapes in TypeScript, generate D1 migration SQL from the briefing schema, and preserve the current query, transaction, validation, and data-compatibility behavior.

The main unresolved design risk is migration history. The existing D1 migration is tracked in `migrations/0001_package_briefings.sql`, and the current operations policy says not to rewrite applied migration history. Therefore, this RFC does **not** carry forward the earlier proposal to reset migration history or drop and recreate a database table. A non-destructive Drizzle baseline strategy must be demonstrated before implementation proceeds.

## Current source baseline

The following describes checked-in source, not the proposed end state:

- [`server/comparison/briefing/store.ts`](../../../server/comparison/briefing/store.ts) issues raw D1 SQL. Reads use `first()`; writes use one D1 `batch()` containing an insert with `ON CONFLICT DO NOTHING` and a select. The select returns the first stored success, preserving first-writer-wins behavior.
- [`workers/evidence/store.ts`](../../../workers/evidence/store.ts) uses synchronous SQL through `transactionSync`. It creates its own evidence tables and partial expiry index, stores chunked JSON, and validates metadata, chunk order, byte length, and JSON when reading.
- [`scripts/export-briefings.ts`](../../../scripts/export-briefings.ts) scans with `node:sqlite` `DatabaseSync.prepare(...).iterate()`. It validates rows and streams escaped SQL output while preserving stored response JSON bytes.
- [`migrations/0001_package_briefings.sql`](../../../migrations/0001_package_briefings.sql) is the current briefing-table migration. [`workers/briefing/wrangler.jsonc`](../../../workers/briefing/wrangler.jsonc) points both the local and preview D1 bindings at `../../migrations`. The reviewed [release and recovery policy](../ops/releases-and-recovery.md#database-and-stored-data-changes) requires new numbered migrations and says not to rewrite applied history.
- [`package.json`](../../../package.json) currently declares Effect `4.0.0`, h3 `^2.0.1-rc.32`, and no direct `drizzle-orm` or `drizzle-kit` dependency. The old proposal's Effect `4.0.0-rc.115` and Drizzle `1.0.0-rc.4` pins are historical investigation values, not current dependencies or approved versions. Its API/type probes against Drizzle rc.4 must be repeated against whichever versions are selected.
- Existing validation uses Effect Schema from shared definition modules such as [`shared/briefing.defs.ts`](../../../shared/briefing.defs.ts). The repository's current Oxlint config bans type assertions and explicit `any`; any adopted driver/test design must work within those rules.

The earlier proposal also assumed a preview-only deployment with no production database and treated restarting migration history as acceptable. Those are not established by the package manifest or Wrangler config. The current operations policy is the safer default until deployment state and any exception are explicitly reviewed.

## Motivation and goals

Raw SQL is currently spread across three distinct runtime environments. A typed schema and query layer could reduce mismatches between column names, query projections, and application row types while keeping the existing Cloudflare and Node execution models intact.

Goals:

1. Use one declared SQLite schema for the D1 briefing table and typed query access to the evidence-cache tables.
2. Replace production query construction with Drizzle where its drivers support the target runtime.
3. Preserve D1 first-writer-wins atomicity and DO synchronous behavior and transaction boundaries.
4. Keep Wrangler—not Drizzle's runtime migrators—as the only D1 migration applier.
5. Preserve the public store APIs, row validation, tagged error behavior, serialized JSON contracts, evidence-cache semantics, and exporter's streaming behavior.
6. Prove generated D1 DDL matches the existing schema and measure any worker/frontend bundle impact before calling the migration successful.

## Non-goals

- Changing briefing/job state, which is outside the SQL stores.
- Changing stored response JSON, its decoder, evidence hashes, cache keys, chunking format, or first-writer-wins semantics.
- Replacing Effect Schema as the wire/domain validation layer or upgrading Effect as part of this change.
- Moving DO table creation to Wrangler migrations. The DO storage has a separate lifecycle and no equivalent Wrangler D1 migration path in this design.
- Using Drizzle runtime migrators, `push`, `pull`, `studio`, or a Drizzle command to apply changes to a database.
- Removing SQL where it intentionally exercises the low-level failure surface: test fault injection/fixture setup and the DO constructor's table/index DDL.
- Resetting a D1 database or deleting applied migration records as an assumed prerequisite.

## Proposed design

### Schema modules

Add two server/worker-only schema modules:

- `shared/db/briefingSchema.ts`: `package_briefings` with `evidence_hash` as the non-null primary key, non-null `response_json`, and non-null `created_at` defaulting to `CURRENT_TIMESTAMP`. This schema is the input to drizzle-kit and the typed model for D1 and exporter queries.
- `shared/db/evidenceSchema.ts`: `evidence_records` (`key`, nullable `expires_at`, non-null `chunk_count`, non-null `byte_length`) and `evidence_chunks` (`key`, `chunk_index`, `payload`, composite primary key). These tables are used to type DO queries but are not emitted as Wrangler migrations; the constructor's existing DDL remains responsible for creating them and the partial expiry index.

Column/table names, nullability, defaults, and keys must match the current SQL exactly. A previous probe against Drizzle rc.4 found that table-level primary-key declarations generated the needed SQLite `NOT NULL` metadata where a column-level `.primaryKey()` did not. Treat that as a version-specific observation to re-check with schema introspection on the chosen Drizzle version, not as a current guarantee.

The schema modules must remain outside browser bundles. Their imports belong only in server, worker, migration-tooling, or exporter code.

### Runtime query clients

| Surface           | Proposed use                                                                                                           | Behavior that must remain unchanged                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 briefing store | `drizzle-orm/d1`, constructed from the existing `D1Database` argument                                                  | Keep public function signatures. A read miss remains `undefined`. `saveBriefing` keeps insert-and-select in one D1 `batch()` so concurrent writers receive the same stored winner.                        |
| Evidence DO cache | Synchronous `drizzle-orm/durable-sqlite` over `DurableObjectStorage`                                                   | Keep cache public operations synchronous where they are now. Use synchronous transactions for replacing a record/chunks and deleting expired records/chunks. Keep constructor DDL and current error tags. |
| Offline exporter  | `drizzle-orm/node-sqlite` to build the ordered select and obtain SQL, then execute it with the existing `DatabaseSync` | Keep `DatabaseSync.iterate()` streaming; do not buffer the full table. Verify the generated query has no bindings rather than coercing unknown parameters. Preserve byte-for-byte stored JSON in output.  |

For evidence cleanup, the proposed query deletes expired chunks selected from expired records and then deletes those records within one transaction. Reads retain the explicit chunk-index order and continue validating metadata and payloads in application code. Writes retain the record/chunk replacement transaction. Drizzle replaces query construction; it does not replace corruption checks or business validation.

The current store error variants remain the public failure surface. Database/driver errors should remain causes of the existing tagged errors; a missing row remains a cache miss rather than an error. Tests should exercise actual D1/DO runtime behavior, not only inspect generated query strings.

### Effect Schema boundary

Keep Effect Schema for current request/domain validation and infer database row types from Drizzle. Do not make `drizzle-orm/effect-schema` part of this proposal by default. The earlier design cited [Drizzle issue #6412](https://github.com/drizzle-team/drizzle-orm/issues/6412) for an older Effect release line; because the current manifest uses Effect `4.0.0`, that historical issue is not evidence that the present package combination is broken. If an adapter is proposed later, check its compatibility with the selected versions and justify the additional coupling separately.

### D1 migration generation and Wrangler integration

The earlier design proposed `drizzle.config.ts` with the briefing schema and a `drizzle/` output directory, plus a `db:generate` script. Drizzle-kit would generate migration SQL; Wrangler would continue applying flat `migrations/*.sql` files using the configured `migrations_dir`.

If the selected drizzle-kit version still uses per-migration folders, a small sync step could mirror each generated `migration.sql` to a flat, timestamp-prefixed migration file for Wrangler. A drift check should compare generated and mirrored files and reject unrecognized stale files. Both generator output and the Wrangler-applied SQL would be committed. Test harnesses would apply committed migrations in sorted filename order and split on Drizzle's statement-breakpoint marker where present.

This adapter/layout is a proposal, not a verified current drizzle-kit contract. Its output format, filename ordering, breakpoint behavior, baseline support, and compatibility with the installed Wrangler version need a focused compatibility check before implementation. The sync guard must account for the immutable existing `0001_package_briefings.sql`; it must never delete or silently rewrite that historical migration.

Most importantly, prove how drizzle-kit can learn the existing `package_briefings` schema without emitting a second `CREATE TABLE` migration for a database that already applied `0001`. Prefer a supported baseline/snapshot mechanism that preserves `0001` and generates only future changes. If the chosen toolchain cannot do that safely, stop and revise the migration design instead of resetting history by default.

### Allowed raw SQL

Under this proposal, raw SQL remains acceptable for:

- DO constructor DDL (`CREATE TABLE IF NOT EXISTS` and the partial expiry index), because it must initialize the DO-owned schema and is not query construction.
- Tests that deliberately install/drop schema or inject corrupt rows/triggers to exercise failure handling.
- The exporter's `DatabaseSync` execution of Drizzle-produced SQL, necessary to preserve synchronous streaming.

All ordinary production selects, inserts, updates/deletes, ordering, and predicates in the named stores should use typed Drizzle query builders.

## Alternatives considered

### Keep the current raw SQL

This avoids dependency, bundle, and generated-migration complexity and is already explicit about the SQL being executed. It leaves the schema and projections manually coordinated across runtime code and migrations. This remains a reasonable choice if the baseline problem or bundle cost outweighs the type-safety benefit.

### Kysely or a lightweight query builder

A typed SQL builder could improve query typing without adopting an ORM's schema DSL. The earlier comparison found that the available Cloudflare community drivers lacked the desired combination of D1 batch support and synchronous DO transactions; this ecosystem assessment can change and should be rechecked before a final decision. Supporting custom execution glue would increase local maintenance, while Drizzle's first-party D1, Durable SQLite, and Node SQLite drivers were a key reason for selecting it in the earlier proposal.

### Drizzle for queries but hand-maintained SQL migrations

This would avoid a generated-folder-to-Wrangler adapter and ease preservation of the current migration file, but the TypeScript schema and manually authored DDL could drift. It is a viable fallback if a safe Drizzle baseline is unavailable; it weakens the schema-generation goal and would need explicit review.

## Tradeoffs and risks

| Risk or tradeoff                                                                | Mitigation / evidence required                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle API or migration format changes; old probe results are version-specific | Select versions only after review, then re-run strict type checks, SQL generation probes, and runtime tests against those exact versions. Do not pin the obsolete rc.4 by inertia. |
| Existing D1 history conflicts with generator bootstrap                          | Preserve `0001` and follow the no-rewrite migration policy. Demonstrate a non-destructive baseline; otherwise revise before touching databases.                                    |
| Generated DDL changes primary-key nullability or defaults                       | Compare `sqlite_master`, `PRAGMA table_info`, and indexes between existing and generated schemas using the selected version.                                                       |
| D1/DO transaction behavior differs through a new driver                         | Exercise real Miniflare D1 and workerd DO paths, including competing D1 writers, DO cleanup, and atomic chunk replacement. Keep API behavior and error-tag tests.                  |
| Typed evidence schema can diverge from constructor DDL                          | Keep exact names/types/keys aligned and test the constructor-created schema through the existing workerd/unit coverage. The asymmetry is intentional and should be documented.     |
| Driver imports increase bundle size or complicate worker boundaries             | Measure dry-run sizes for affected workers and the Nuxt worker before/after; verify schema modules do not enter browser bundles.                                                   |
| Test doubles drift from the global DO storage interface                         | If `drizzle(storage)` requires the complete `DurableObjectStorage` type, provide a typed test helper without casts and keep compile-time coverage.                                 |
| Exporter changes SQL shape or stops streaming                                   | Retain `DatabaseSync.iterate()`, verify zero query parameters, and run exporter behavior coverage against realistic legacy rows.                                                   |
| Schema/type layer adds value but no operational need                            | Reconsider adoption if the dependencies or migration bridge cost more than the reduction in query/schema mismatch risk.                                                            |

## Migration and rollout proposal

1. **Resolve review gates first.** Choose Drizzle/drizzle-kit versions, establish current database/deployment state, and prove a baseline path compatible with the immutable `0001` migration. No production or preview operation is included in this RFC.
2. **Characterize the existing schema and behavior.** Record the current D1 table/index metadata and exercise the existing D1 batch, DO synchronous transactions, error wrappers, and exporter output as the baseline. Any generated DDL must be introspection-equivalent before it is considered.
3. **Add schema and generation tooling without changing runtime queries.** Establish schema modules, configuration, and the Wrangler migration mirror only after the baseline strategy works. Preserve the current migration file and state.
4. **Convert one boundary at a time.** Migrate D1 reads/writes first, then DO cache queries/transactions, then exporter query construction. Keep each public API and stored format unchanged; use real runtime suites for each boundary.
5. **Update documentation and measure.** Document the generation workflow and migration ownership in the current development/release documentation; run the repository's relevant full verification and smoke paths once integrated; report bundle changes rather than assuming neutrality.
6. **Treat any remote D1 migration as a separate operations decision.** Follow the current release/recovery policy, identify exact target state, rehearse backup/restore and compatibility, and obtain explicit approval before applying. Do not drop tables, clear `d1_migrations`, re-import rows, or claim a history reset is harmless as part of this RFC.

The old reset plan relied on an assumption that preview data/history could be discarded or rebuilt and suggested exporting/re-importing before dropping the table and clearing migration records. That is retained only as an option requiring a specific policy exception and verified operator procedure; it is not the recommended rollout. The current release policy emphasizes preserving applied history and stored results.

## Review questions

1. Is adopting Drizzle still desirable, given the new dependency, bundle, and migration-bridge costs, or should the current raw SQL remain?
2. Which currently supported `drizzle-orm` and `drizzle-kit` versions should be evaluated, and should they be exact-pinned together? The old `1.0.0-rc.4` values are not a recommendation.
3. What is the acceptable way to seed Drizzle's migration state from the existing `0001_package_briefings.sql` without reapplying its DDL or rewriting history? If no supported path exists, is hand-maintained SQL migration history an acceptable compromise?
4. What is the verified current state of preview/other D1 databases and their stored rows? Is any exception to the reviewed no-rewrite/no-discard policy under consideration? This RFC assumes none.
5. Is keeping evidence-table DDL in the DO constructor while using a typed Drizzle schema acceptable, or should schema management be revisited separately?
6. Are the proposed raw-SQL exceptions (DO setup DDL, test fault injection, exporter execution) the right boundary?
7. What bundle-size increase, if any, is acceptable for the Worker and Nuxt deployments?
8. Should Effect Schema remain independent of Drizzle as proposed, or should a typed adapter be evaluated after checking current-version compatibility?

## References

- Current code and configuration: [`package.json`](../../../package.json), [`workers/briefing/wrangler.jsonc`](../../../workers/briefing/wrangler.jsonc), [`migrations/0001_package_briefings.sql`](../../../migrations/0001_package_briefings.sql), [`server/comparison/briefing/store.ts`](../../../server/comparison/briefing/store.ts), [`workers/evidence/store.ts`](../../../workers/evidence/store.ts), [`scripts/export-briefings.ts`](../../../scripts/export-briefings.ts).
- Project migration policy: [Database and stored-data changes](../ops/releases-and-recovery.md#database-and-stored-data-changes).
- Drizzle documentation: [D1 batch API](https://orm.drizzle.team/docs/sqlite/batch-api), [SQLite migrations](https://orm.drizzle.team/docs/sqlite/drizzle-kit-generate), [Drizzle config](https://orm.drizzle.team/docs/drizzle-config-file), [v0-to-v1 changes](https://orm.drizzle.team/docs/v0-v1-changes).
- Cloudflare documentation: [Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).
- Kysely dialect overview: [Kysely dialects](https://www.kysely.dev/docs/dialects). Driver capabilities must be checked against versions current at implementation time.
