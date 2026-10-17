# RFC 0001: Drizzle database layer

**Status:** APPROVED — implementation and local cutover verified; stage cutover blocked on maintenance/quiescence  
**ADR:** [Drizzle database layer](../adrs/drizzle-database-layer.md)  
**Date:** 2026-10-03  
**Decision (2026-10-04):** The user approved the proposed Drizzle database-layer design after reviewing the feasibility research and explicitly approved restarting migration history and resetting the local and preview D1 databases for the cutover. The user confirmed that the application is not yet deployed to production. This is a scoped exception to the no-rewrite migration policy, not a general permission to reset other databases. Approval does not mean implementation or full compatibility verification is complete. No reset has been executed as part of recording this decision; rollout remains subject to the implementation acceptance checks below.

**Retention amendment (2026-10-05):** The user explicitly approved discarding the old briefing rows instead of restoring them. The local reset is executed and verified; preview remains unmodified because maintenance/quiescence prerequisites are unavailable. Actual execution evidence is recorded in the ADR.

**Initialization amendment (2026-10-05):** The user approved removing handwritten DO constructor DDL. Drizzle Kit generates evidence-only SQL/snapshots, and the synchronous DO migrator applies its bundled history. Only the initial generated bootstrap gains idempotent CREATE statements to adopt existing tables without resetting evidence data. A narrowly scoped pinned ORM patch preserves underlying migration SQL causes. This supersedes the original constructor-DDL exception.

**Historical terminology:** This dated proposal retains “preview” for the hosted target now called `stage`. Current selectors and commands are in [deployment operations](../ops/deployment.md#migrating-logical-environment-selectors-and-gitlab-scopes); the physical resources and the scope of the original reset approval are unchanged.

## Summary

Adopt Drizzle as the typed query layer for the application's SQLite-backed data paths: Cloudflare D1 briefing storage, synchronous Durable Object (DO) evidence storage, and SQL construction in the offline briefing exporter. Keep Wrangler as the D1 migration applier. Declare table shapes in TypeScript, generate D1 migration SQL from the briefing schema, and preserve the current query, transaction, validation, and data-compatibility behavior.

Migration history will restart at the user-approved cutover: replace the current D1 migration history with generated initial migrations and reset both local and preview D1 databases before applying them with Wrangler. Preserving the existing `0001_package_briefings.sql` history or proving a non-destructive baseline is no longer an adoption gate. Exact reset targets, data retention/export requirements, and the operator procedure must be recorded before execution; this decision does not extend to Durable Object state or any production database.

## Pre-adoption source baseline

This is the decision's historical baseline; source links now point to the migrated implementations. Current operation and the scoped reset procedure are documented in [development](../ops/development.md#how-do-i-change-or-apply-the-database-schema) and [releases/recovery](../ops/releases-and-recovery.md#one-time-drizzle-adoption-cutover).

- The [briefing store](../../../server/comparison/briefing/store.ts) previously issued raw D1 SQL using `first()` and one insert/select `batch()`. Its Drizzle replacement retains that batch and first-writer-wins contract.
- The [evidence store](../../../workers/evidence/store.ts) previously built synchronous SQL directly through `transactionSync`. Its typed full-storage client applies generated synchronous DO migrations and retains transactions, chunked JSON and read validation.
- The former offline exporter executed `DatabaseSync.prepare(...).iterate()`, validated each row and streamed escaped SQL preserving original JSON/timestamps; Drizzle replaced only SELECT construction. The exporter has since been removed; its proposed behavior below is historical.
- The old initial history was `0001_package_briefings.sql`. The [briefing declaration](../../../shared/db/briefingSchema.ts) now generates [SQL/snapshot history](../../../drizzle/) and [flat Wrangler mirrors](../../../migrations/). Both [D1 bindings](../../../workers/briefing/wrangler.jsonc) retain `../../migrations`; subsequent applied history remains append-only.
- The pre-adoption [manifest](../../../package.json) had Effect `4.0.0`, h3 `^2.0.1-rc.32`, and no direct Drizzle dependency. ORM and Kit are now exact-pinned to the approved `1.0.0-rc.5-ab785fc`, without upgrading Effect or the baseline dependency versions. Earlier Effect `4.0.0-rc.115` and Drizzle `1.0.0-rc.4` proposal values remain superseded, not adopted pins.
- Validation continues to use independent Effect Schema definitions such as [briefing.defs.ts](../../../shared/comparison/briefing/briefing.defs.ts). Driver compatibility uses narrowly imported SDK type aliases instead of blanket Cloudflare globals; implementation remains subject to the assertion/explicit-`any` rules.

The user confirmed on 2026-10-04 that the application is not yet deployed to production and explicitly approved local and preview database resets and restarting migration history. This user decision supplies the deployment context and scoped policy exception; the package manifest and Wrangler config alone do not establish it.

## Motivation and goals

Before adoption, handwritten SQL was spread across three distinct runtime environments. A typed schema and query layer was selected to reduce mismatches between column names, query projections, and application row types while keeping the existing Cloudflare and Node execution models intact.

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
- Resetting databases outside the user-approved local and preview D1 targets, or resetting Durable Object state.

## Proposed design

### Schema modules

Add two server/worker-only schema modules:

- `shared/db/briefingSchema.ts`: `package_briefings` with `evidence_hash` as the non-null primary key, non-null `response_json`, and non-null `created_at` defaulting to `CURRENT_TIMESTAMP`. This schema is the input to drizzle-kit and the typed model for D1 and exporter queries.
- `shared/db/evidenceSchema.ts`: `evidence_records` (`key`, nullable `expires_at`, non-null `chunk_count`, non-null `byte_length`) and `evidence_chunks` (`key`, `chunk_index`, `payload`, composite primary key). These tables are used to type DO queries but are not emitted as Wrangler migrations; the constructor's existing DDL remains responsible for creating them and the partial expiry index.

Column/table names, nullability, defaults, and keys must match the current SQL exactly. A previous probe against Drizzle rc.4 found that table-level primary-key declarations generated the needed SQLite `NOT NULL` metadata where a column-level `.primaryKey()` did not. Treat that as a version-specific observation to re-check with schema introspection on the chosen Drizzle version, not as a current guarantee.

The schema modules must remain outside browser bundles. Their imports belong only in server, worker, migration-tooling, or exporter code.

### Runtime query clients

| Surface           | Proposed use                                                                                                           | Behavior that must remain unchanged                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 briefing store | `drizzle-orm/d1`, constructed from the existing `D1Database` argument                                                  | Keep public function signatures. A read miss remains `undefined`. `saveBriefing` keeps insert-and-select in one D1 `batch()` so concurrent writers receive the same stored winner.                                                           |
| Evidence DO cache | Synchronous `drizzle-orm/durable-sqlite` over `DurableObjectStorage`                                                   | Keep cache public operations synchronous where they are now. Use synchronous transactions for replacing a record/chunks and deleting expired records/chunks. Apply generated DO migrations synchronously and keep current error tags/causes. |
| Offline exporter  | `drizzle-orm/node-sqlite` to build the ordered select and obtain SQL, then execute it with the existing `DatabaseSync` | Keep `DatabaseSync.iterate()` streaming; do not buffer the full table. Verify the generated query has no bindings rather than coercing unknown parameters. Preserve byte-for-byte stored JSON in output.                                     |

For evidence cleanup, the proposed query deletes expired chunks selected from expired records and then deletes those records within one transaction. Reads retain the explicit chunk-index order and continue validating metadata and payloads in application code. Writes retain the record/chunk replacement transaction. Drizzle replaces query construction; it does not replace corruption checks or business validation.

The current store error variants remain the public failure surface. Database/driver errors should remain causes of the existing tagged errors; a missing row remains a cache miss rather than an error. Tests should exercise actual D1/DO runtime behavior, not only inspect generated query strings.

### Effect Schema boundary

Keep Effect Schema for current request/domain validation and infer database row types from Drizzle. Do not make `drizzle-orm/effect-schema` part of this proposal by default. The earlier design cited [Drizzle issue #6412](https://github.com/drizzle-team/drizzle-orm/issues/6412) for an older Effect release line; because the current manifest uses Effect `4.0.0`, that historical issue is not evidence that the present package combination is broken. If an adapter is proposed later, check its compatibility with the selected versions and justify the additional coupling separately.

### D1 migration generation and Wrangler integration

The earlier design proposed `drizzle.config.ts` with the briefing schema and a `drizzle/` output directory, plus a `db:generate` script. Drizzle-kit would generate migration SQL; Wrangler would continue applying flat `migrations/*.sql` files using the configured `migrations_dir`.

If the selected drizzle-kit version still uses per-migration folders, a small sync step could mirror each generated `migration.sql` to a flat, timestamp-prefixed migration file for Wrangler. A drift check should compare generated and mirrored files and reject unrecognized stale files. Both generator output and the Wrangler-applied SQL would be committed. Test harnesses would apply committed migrations in sorted filename order and split on Drizzle's statement-breakpoint marker where present.

The selected toolchain's output format, filename ordering, breakpoint behavior, and compatibility with Wrangler must be verified before implementation. At the approved cutover, replace the old `0001_package_briefings.sql` migration with the new generated initial history and mirror it for Wrangler. Reset the local and preview D1 databases before applying that history: do not apply the fresh initial `CREATE TABLE` to an existing table and treat the resulting collision as a baseline requirement. The sync guard should enforce the new generated history after cutover; ordinary future migrations remain append-only under the release policy.

Rehearse the reset and fresh initialization locally before the preview operation. Record the exact preview database identity and resolve data retention/export requirements before resetting it. A production database reset is outside this decision.

### Allowed raw SQL

Under this proposal, raw SQL remains acceptable for:

- Kit-generated migration SQL applied by the appropriate migrator, including the build-time-adapted initial DO bootstrap; no handwritten production constructor DDL.
- Tests that deliberately install/drop schema or inject corrupt rows/triggers to exercise failure handling.
- The exporter's `DatabaseSync` execution of Drizzle-produced SQL, necessary to preserve synchronous streaming.

All ordinary production selects, inserts, updates/deletes, ordering, and predicates in the named stores should use typed Drizzle query builders.

## Alternatives considered

### Keep the current raw SQL

This avoids dependency, bundle, and generated-migration complexity and is already explicit about the SQL being executed. It leaves the schema and projections manually coordinated across runtime code and migrations. This remains a reasonable choice if tooling or bundle cost outweighs the type-safety benefit.

### Kysely or a lightweight query builder

A typed SQL builder could improve query typing without adopting an ORM's schema DSL. The earlier comparison found that the available Cloudflare community drivers lacked the desired combination of D1 batch support and synchronous DO transactions; this ecosystem assessment can change and should be rechecked before a final decision. Supporting custom execution glue would increase local maintenance, while Drizzle's first-party D1, Durable SQLite, and Node SQLite drivers were a key reason for selecting it in the earlier proposal.

### Drizzle for queries but hand-maintained SQL migrations

This would avoid a generated-folder-to-Wrangler adapter, but the TypeScript schema and manually authored DDL could drift. It remains an alternative if generation tooling costs outweigh its benefits; it weakens the schema-generation goal and would need explicit review. The approved reset removes lack of a safe baseline as a reason to require this fallback.

## Feasibility research (2026-10-04)

The throwaway spike demonstrated workable query paths, not full application compatibility. Its isolated worktree was removed afterward; no application dependencies or remote databases were changed.

- Stable `drizzle-orm` `0.45.3` lacked the proposed `node-sqlite` entrypoint. Runtime probes used installed `drizzle-orm` and `drizzle-kit` `1.0.0-rc.5-ab785fc`. The `rc` alias lookup reported rc.4, but the package manager's caret resolution installed this later prerelease. Exact installed versions must be pinned and verified during implementation rather than relying on aliases or ranges.
- The RC generated a text primary key without explicit `NOT NULL` from the column-level declaration, even with `.notNull()`. A table-level primary-key declaration generated matching `PRAGMA table_info` metadata for the briefing table. This is an implementation requirement to recheck against the chosen versions.
- Two competing local workerd D1 requests using Drizzle's insert-and-select batch returned the same stored winner. This does not establish all failure/error-tag behavior.
- A local workerd Durable Object successfully executed synchronous inserts inside `transactionSync` and read them through Drizzle. Atomic replacement, rollback on failure, expiry cleanup, and corruption checks were not exercised by this probe.
- The Node SQLite adapter generated a zero-parameter ordered select executable through `DatabaseSync.iterate()`, preserving stored JSON in a one-row fixture. Full exporter behavior and large-data streaming remain acceptance checks.
- A narrow D1/DO adapter type probe passed with `skipLibCheck`, consistent with the briefing worker's current setting. Full application type-checking and cast-free test helpers remain unverified; standalone declaration checking encountered conflicts, including a missing `@miniflare/d1` reference.
- Minimal D1 worker dry-run sizes were 198.77 KiB / 38.27 KiB gzip with Drizzle and 0.59 KiB / 0.35 KiB gzip for the raw-SQL control. This is an indicative dependency cost, not a real Worker/Nuxt before-and-after measurement or browser-boundary verification.
- A snapshot-and-delta baseline was feasible with the RC and a generated column addition applied through local Wrangler preserved a fixture row. The approved local/preview reset means this baseline is not required for adoption.

No architectural blocker was demonstrated. The unchecked behavior and actual application bundle impact must be verified before rollout; the spike alone is not rollout approval.

## Tradeoffs and risks

| Risk or tradeoff                                                                | Mitigation / evidence required                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle API or migration format changes; old probe results are version-specific | Select versions only after review, then re-run strict type checks, SQL generation probes, and runtime tests against those exact versions. Do not pin the obsolete rc.4 by inertia. |
| Existing D1 history conflicts with generator bootstrap                          | Use the user-approved local/preview reset at cutover; verify target identities and fresh initialization. Do not extend this exception to future migrations or production.          |
| Generated DDL changes primary-key nullability or defaults                       | Compare `sqlite_master`, `PRAGMA table_info`, and indexes between existing and generated schemas using the selected version.                                                       |
| D1/DO transaction behavior differs through a new driver                         | Exercise real Miniflare D1 and workerd DO paths, including competing D1 writers, DO cleanup, and atomic chunk replacement. Keep API behavior and error-tag tests.                  |
| Generated DO history can drift or fail existing-table adoption                  | Generate from the evidence declaration, check the immutable runtime bundle, and prove existing-data adoption, restart and transactional failure through real-workerd coverage.     |
| Driver imports increase bundle size or complicate worker boundaries             | Measure dry-run sizes for affected workers and the Nuxt worker before/after; verify schema modules do not enter browser bundles.                                                   |
| Test doubles drift from the global DO storage interface                         | If `drizzle(storage)` requires the complete `DurableObjectStorage` type, provide a typed test helper without casts and keep compile-time coverage.                                 |
| Exporter changes SQL shape or stops streaming                                   | Retain `DatabaseSync.iterate()`, verify zero query parameters, and run exporter behavior coverage against realistic legacy rows.                                                   |
| Schema/type layer adds value but no operational need                            | Reconsider adoption if the dependencies or migration bridge cost more than the reduction in query/schema mismatch risk.                                                            |

## Migration and rollout proposal

1. **Select and exact-pin the implementation versions.** Adoption of the proposed design is approved. Confirm the installed Drizzle/drizzle-kit pair and repeat compatibility checks for that pair. The user has confirmed no production deployment and approved local/preview database resets; a non-destructive migration baseline is not required.
2. **Characterize the existing schema and behavior.** Record the current D1 table/index metadata and exercise the existing D1 batch, DO synchronous transactions, error wrappers, and exporter output as the baseline. Any generated DDL must be introspection-equivalent before it is considered.
3. **Add schema and generation tooling.** Establish schema modules, configuration, generated initial migrations, and the Wrangler migration mirror. Replace the old migration history as part of the approved cutover and prove fresh initialization in a disposable local database.
4. **Convert one boundary at a time.** Migrate D1 reads/writes first, then DO cache queries/transactions, then exporter query construction. Keep each public API and stored format unchanged; use real runtime suites for each boundary.
5. **Update documentation and measure.** Document the generation workflow and migration ownership in the current development/release documentation; run the repository's relevant full verification and smoke paths once integrated; report bundle changes rather than assuming neutrality.
6. **Execute the scoped local and preview reset.** Identify exact target databases, resolve data retention/export requirements, rehearse the operator procedure locally, then reset local and preview D1 state and apply the fresh migrations through Wrangler. Verify schema, migration records, and store behavior afterward. Do not reset Durable Object state or target production. Record actual execution separately from this approval; future applied migration history remains append-only.

The local/preview reset is now the user-approved migration strategy, not an assumption inferred by an agent. The exception is limited to this pre-production cutover; the general release/recovery policy remains in force outside that scope.

## Implementation acceptance checks

The amended approved design generates and applies DO initialization through Drizzle, retains only the stated non-constructor raw-SQL exceptions, and keeps Effect Schema independent. Acceptance also requires populated legacy adoption without data loss, persisted reopen without migration replay, and original migration failure causes.

1. Exact-pin and verify the installed ORM/Kit versions; demonstrate the three required runtime adapters and full application type compatibility without introducing casts or explicit `any`.
2. Prove generated schema equivalence, including explicit primary-key nullability, defaults, and indexes; verify migration mirror ordering and statement splitting.
3. Exercise real D1 competing writers, misses, and failures, and preserve public error tags and causes.
4. Exercise real DO atomic chunk replacement, rollback on failure, expiry cleanup, ordering, and application corruption checks; retain synchronous operations and transaction boundaries.
5. Verify the actual exporter preserves stored JSON and escaped output while retaining streaming iteration and zero query bindings.
6. Measure real Worker and Nuxt before-and-after bundle sizes and verify database schema/driver imports do not enter browser bundles. If measured impact materially changes the adoption tradeoff, bring that evidence back for review before rollout.
7. Record the local/preview reset procedure, exact targets, and stored-data retention/export requirements; rehearse fresh initialization locally and verify migration records and store behavior after reset. Production and DO state are outside the reset approval.

## References

- Current code and configuration: [`package.json`](../../../package.json), [`workers/briefing/wrangler.jsonc`](../../../workers/briefing/wrangler.jsonc), [briefing schema](../../../shared/db/briefingSchema.ts), [generated migrations](../../../migrations/), [`server/comparison/briefing/store.ts`](../../../server/comparison/briefing/store.ts), [`workers/evidence/store.ts`](../../../workers/evidence/store.ts).
- Project migration policy: [Database and stored-data changes](../ops/releases-and-recovery.md#database-and-stored-data-changes).
- Drizzle documentation: [D1 batch API](https://orm.drizzle.team/docs/sqlite/batch-api), [SQLite migrations](https://orm.drizzle.team/docs/sqlite/drizzle-kit-generate), [Drizzle config](https://orm.drizzle.team/docs/drizzle-config-file), [v0-to-v1 changes](https://orm.drizzle.team/docs/v0-v1-changes).
- Cloudflare documentation: [Durable Object SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).
- Kysely dialect overview: [Kysely dialects](https://www.kysely.dev/docs/dialects). Driver capabilities must be checked against versions current at implementation time.
