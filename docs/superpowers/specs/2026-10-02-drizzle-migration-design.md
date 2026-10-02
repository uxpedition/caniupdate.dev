# Drizzle database layer migration design

**Date:** 2026-10-02

**Status:** Design approved in discussion; written-spec review pending. No implementation or deployment approved by this document.

## Goal and constraints

Replace every raw SQL statement in application code with Drizzle ORM, and make the schema the typed source of truth for both queries and migrations. The benchmark for the finished migration is: the same schema, expressed by drizzle-kit-generated SQL and verified introspection-identical, and the same queries, expressed through Drizzle and verified by the existing behavioral suites plus the local smoke run.

Constraints this design keeps:

- Runtime targets are the Nuxt Worker, the evidence Durable Object SQLite, and the offline Node exporter. The Durable Object and `node:sqlite` drivers are **synchronous**; the code must stay synchronous where it is today.
- Wrangler remains the **only** migration applier (`workers/briefing/wrangler.jsonc`, `migrations_dir: "../../migrations"`). Drizzle-kit generates SQL; it never applies it.
- `effect@4.0.0-rc.115` stays pinned as published. `drizzle-orm/effect-schema` is **not** imported (see [effect-schema exclusion](#effect-schema-exclusion)).
- The lint config bans type assertions (`typescript/consistent-type-assertions: never`), so no `as` bridges anywhere, including tests.
- The project pins rc dependencies exactly (Effect, h3); `drizzle-orm` and `drizzle-kit` are pinned to `1.0.0-rc.4` (the `rc` dist-tag of both packages).
- Only preview is deployed; there is no production database. Migration history may restart from zero, and this document treats that as the chosen path.

## Library decision

Drizzle was selected over Kysely after reviewing both:

- Drizzle ships first-party drivers for all three targets in one version (`drizzle-orm/d1`, `drizzle-orm/durable-sqlite`, `drizzle-orm/node-sqlite`); the DO and Node drivers are synchronous, matching the existing code shape (`SqlEvidenceCache` internals are sync; the exporter streams with `DatabaseSync`).
- Kysely has no official Cloudflare dialect. The community `kysely-d1` driver throws on transactions and does not use D1 `batch()` — the current `saveBriefing` atomicity would have to be rebuilt by hand — and `kysely-do` is `0.0.1-rc.1`. Using Kysely would mean maintaining execution glue, which this project explicitly does not want.
- Verified in `drizzle-orm@1.0.0-rc.4` type definitions: `DrizzleD1Database.batch<U, T>(batch: T): Promise<BatchResponse<T>>`; `durable-sqlite` sessions wrap the sync `DurableObjectStorage` (`transaction()` delegates to `storage.transactionSync`); `node-sqlite` wraps `DatabaseSync` with sync `.all()/.get()/.run()`; select builders expose `toSQL(): { sql: string; params: unknown[] }`.

### Effect-schema exclusion

`drizzle-orm/effect-schema` is the only Drizzle entrypoint that imports Effect, and it is currently broken against Effect ≥ rc.118 ([drizzle-orm#6412](https://github.com/drizzle-team/drizzle-orm/issues/6412)). This design keeps Effect Schema where it is: wire/domain validation in `shared/*.defs.ts`. Table row types come from Drizzle's inference. No Effect upgrade is part of this work.

## Scope

In scope:

- `server/utils/packageBriefingStore.ts` — D1 reads/writes, including the atomic insert/select batch.
- `workers/evidence/store.ts` (`SqlEvidenceCache`) — DO SQLite reads, writes, expiry sweep, transactions.
- `scripts/export-briefings.ts` — SQL construction (execution stays `node:sqlite`).
- `migrations/` history reset + drizzle-kit generator (`drizzle.config.ts`, `db:generate` script).
- Test harnesses and fixtures that reference migration files or raw SQL predicates.
- Docs describing the schema/migration workflow.

Out of scope:

- `BriefingJob` job state (KV API + alarms, no SQL).
- Drizzle runtime migrators (`drizzle-orm/d1/migrator`, `durable-sqlite/migrator`), `drizzle-kit push/pull/studio/migrate`. Wrangler applies.
- Runtime DDL for the evidence tables. The DO has no wrangler migration path; `CREATE TABLE IF NOT EXISTS` stays in the `SqlEvidenceCache` constructor, guarded by the existing workerd/unit suites. This is an accepted asymmetry: D1 is migration-managed and typed; DO DDL is constructor-managed and typed.
- Test fault-injection SQL (`DROP TABLE`, `CREATE TRIGGER`, corrupt-row inserts, schema install in harnesses) stays raw `prepare` — it deliberately exercises the failure surface beneath the typed layer.
- Stored JSON contracts and hash identity. `response_json` bytes and decoding behavior do not change.

## Architecture

### Schema modules

- `shared/db/briefingSchema.ts` — `packageBriefings` (`package_briefings`) table. Consumed by the D1 store, the exporter, and drizzle-kit.
- `shared/db/evidenceSchema.ts` — `evidenceRecords`, `evidenceChunks` tables. Consumed by the DO cache; not fed to drizzle-kit.
- Column and table names match `migrations` exactly. Primary keys are declared at table level with the v1 extra-config object form. This is not cosmetic: column-level `.primaryKey()` drops `NOT NULL` from generated SQLite DDL (probe-verified: `.notNull().primaryKey()` → `text PRIMARY KEY`), while table-level `primaryKey({ columns })` emits `text PRIMARY KEY NOT NULL`, matching the deployed table. `evidence_chunks` uses the composite form `(t) => ({ pk: primaryKey({ columns: [t.key, t.chunkIndex] }) })`.
- Drizzle's `sqliteTable` and column builders are imported from `drizzle-orm/sqlite-core`; all runtime usage remains inside server/worker bundles (nothing from `shared/db/` reaches the browser bundle).

### Runtime clients

| Surface | Construction | Notes |
| --- | --- | --- |
| D1 (`packageBriefingStore`) | `drizzle(database)` from `drizzle-orm/d1`, created per call | Public signatures stay `(database: D1Database, …)`; `BriefingJob` and the Nuxt route need no changes |
| DO (`SqlEvidenceCache`) | `drizzle(storage)` from `drizzle-orm/durable-sqlite`, created in the constructor | Constructor parameter becomes `DurableObjectStorage` (see testability) |
| Exporter (`scripts/export-briefings.ts`) | `drizzle({ client: database })` from `drizzle-orm/node-sqlite`, used only for `.toSQL()` | Row scan stays `DatabaseSync.prepare(...).iterate()` |

### Schema management

- `drizzle.config.ts`: `dialect: 'sqlite'`, `schema: './shared/db/briefingSchema.ts'`, `out: './drizzle'`.
- drizzle-kit v1 layout (probe-verified on rc.4): each migration is a folder `drizzle/<YYYYMMDDHHMMSS>_<name>/` containing `migration.sql` and `snapshot.json`; there is no `journal.json` and no flat-file mode. Wrangler's `migrations_dir` only reads top-level `*.sql` files, so a thin adapter is required.
- New script `scripts/sync-migrations.ts` mirrors each `drizzle/<folder>/migration.sql` to `migrations/<folder>.sql` (flattened; lexicographic order equals chronological order for wrangler). It errors on stale flat files with no drizzle source. New script `"db:generate": "drizzle-kit generate && node scripts/sync-migrations.ts"`, run as `nub run --node db:generate`; the baseline is generated with `--name package_briefings`.
- Committed artifacts: `drizzle/<folder>/{migration.sql,snapshot.json}` (generator history) and `migrations/<folder>.sql` (wrangler-applied). A unit test asserts the flat mirror is byte-identical and complete, so a forgotten `db:generate` run fails the suite.
- `db:migrate:local`, `scripts/dev.ts`, and remote deployment flows are unchanged: wrangler applies the flat `*.sql` files and records them in `d1_migrations`. Hand-written `migrations/0001_package_briefings.sql` is deleted.

### Migration history reset (start from zero)

Because only preview is deployed and schema history may restart:

1. Write `briefingSchema.ts` to match the deployed table, run `db:generate`, and compare the generated SQL against the old `0001` by introspecting two fresh local databases (`sqlite_master` + `PRAGMA table_info` + `PRAGMA index_list`) — the schemas must be identical after whitespace/quoting normalization. This equivalence check is a migration-time rehearsal, not a permanent test.
2. Commit `drizzle/<folder>/{migration.sql,snapshot.json}` and the synced `migrations/<folder>.sql`; delete `0001_package_briefings.sql`.
3. Local: reset `.wrangler/state` once (local-only, git-ignored state; the launcher must not be running), then `nub run --node db:migrate:local` applies the generated baseline. Local state is disposable; no data preservation needed.
4. Preview (reviewed ops step, separately approved, not part of code batches): preserve briefing rows with a data-only `wrangler d1 export --remote --env preview` before the reset, drop `package_briefings`, delete the stale `d1_migrations` row(s), apply the generated migrations with `wrangler d1 migrations apply BRIEFINGS_DB --remote --env preview --config workers/briefing/wrangler.jsonc`, then re-import the preserved data. Wiping instead of preserving is an operator choice that accepts regeneration cost. Exact `wrangler d1 export` flags are verified during rehearsal.
5. Test harnesses (`test/helpers/briefingDatabase.harness.ts`, `workers/briefing/test/worker.harness.ts`) read every `migrations/*.sql` file in sorted order and run each statement (splitting on drizzle-kit's `--> statement-breakpoint` marker), mirroring wrangler's application order. The install helper's "idempotent" comment is updated: the generated `CREATE TABLE` is not idempotent, and its call sites (fresh schema, or re-create after an explicit `DROP`) do not require it to be.

## Query mapping

| Current (raw) | Replacement |
| --- | --- |
| `SELECT response_json FROM package_briefings WHERE evidence_hash = ?` + `.first()` | `select({ responseJson: … }).where(eq(packageBriefings.evidenceHash, hash)).get()`; `.get()` returns `undefined` on a miss, which is the existing miss branch |
| `batch([INSERT … ON CONFLICT DO NOTHING, SELECT …])` | `db.batch([db.insert(…).values(…).onConflictDoNothing(), select])` — still one D1 `batch()` call, so first-writer-wins atomicity is unchanged |
| `CREATE TABLE IF NOT EXISTS evidence_records/evidence_chunks` + partial index | Unchanged constructor DDL |
| `DELETE FROM evidence_chunks WHERE key IN (SELECT key FROM evidence_records WHERE expires_at IS NOT NULL AND expires_at <= ?)` + `DELETE FROM evidence_records …` | Inside `db.transaction(tx => …)`: `tx.delete(evidenceChunks).where(inArray(evidenceChunks.key, subquery))` + `tx.delete(evidenceRecords).where(and(isNotNull(…), lte(…)))`, both `.run()` |
| `SELECT key, expires_at, chunk_count, byte_length FROM evidence_records WHERE key = ?` | `select({…}).where(eq(evidenceRecords.key, key)).get()` |
| `SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index ASC` | `select({…}).where(eq(…)).orderBy(asc(chunkIndex)).all()` |
| `transactionSync` delete/insert record + chunk loop | `db.transaction(tx => …)`; sync callback, `tx.insert(…).values(…).run()` per chunk |
| `transactionSync` delete both tables | `db.transaction(tx => …)` |
| Exporter `SELECT evidence_hash, response_json, created_at … ORDER BY evidence_hash` | `.toSQL()` for the statement; execute with `DatabaseSync.prepare(sql).iterate()`. The statement has no parameters; the script validates `params.length === 0` rather than coercing `unknown[]` into bindings |

Error handling is unchanged: the same `BriefingStoreError` / `BriefingStoreCorruptionError` / `BriefingStoreValidationError` and `EvidenceStorageError` / `EvidenceStorageCorruptionError` tags wrap failures, with Drizzle/D1 errors as `cause`. Row validation, chunk-order checks, byte-length checks, JSON decoding, and the "missing row is not a failure" distinction all stay in application code.

## Testability

`DurableObjectStorage` has ~19 members (`sql`, `kv`, alarms, bookmarks, KV methods), and `drizzle(storage)` requires that full interface; `as` casts are banned. The existing minimal fake in `workers/evidence/store.unit.ts` therefore becomes a test helper (`workers/evidence/test/doStorageStub.ts`, `doStorageStub()`) that satisfies the interface with no-op defaults and an overridable `sql.exec` whose cursor provides `toArray()` and `raw()`. The two storage-failure tests are kept:

- construction failure: stub `sql.exec` throws → `EvidenceStorageError { operation: 'initialize' }`.
- read failure: the fault predicate must match Drizzle-emitted SQL (lowercase quoted identifiers, e.g. `select "key", "expires_at" … from "evidence_records"`), not the old uppercase literal.

D1 tests keep using real Miniflare D1 through `installBriefingSchema`, so any disagreement between `briefingSchema.ts` and the migration fails the suite. The exporter suite keeps its fixture database and SQL-text assertions.

## Verification

Per-batch: type-check (`nuxt typecheck` + both worker tsconfigs), `nub run --node test`, `lint:check`, `format:check`. End-to-end: `node scripts/smoke.ts` exercises briefing submission, socket completion, restart, and D1 reuse through the new code. Bundle impact: record `wrangler deploy --dry-run` sizes for both workers and the built Nuxt worker before/after; report growth rather than assume it.

Before this plan, a throwaway probe under Node 26 confirmed against `drizzle-orm@1.0.0-rc.4`: the DO storage stub is assignable to `DurableObjectStorage` with no type assertions, `drizzle(storage)` + sync `db.transaction` + `inArray(column, subquery)` + `.get()/.all()` type-check strictly, and `drizzle(database).batch([insert, select])` yields typed rows on the D1 driver. The probe also fixed the schema details above (PK nullability, folder layout, idempotent regeneration).

TDD applies normally: the D1 batch atomicity path and the DO transaction path get red-first coverage where the existing suite only implicitly exercises them; otherwise the existing suites are the regression net, and tests pinning incidental raw-SQL text are updated with the implementation, not preserved.

## Delivery batches

0. Dependency + schema modules + `drizzle.config.ts` + generated baseline + history reset + harness path updates + schema-equivalence rehearsal.
1. D1 `packageBriefingStore` through Drizzle (public signatures unchanged).
2. `SqlEvidenceCache` through Drizzle + `doStorageStub` + `store.unit.ts` adaptation.
3. Exporter through Drizzle for SQL construction; streaming execution unchanged.
4. Full verification (type-check, tests, lint, format, smoke, bundle sizes) + docs updates (`development.md` generation workflow, README where it describes schema/migrations).

## Risks

| Risk | Mitigation |
| --- | --- |
| rc.4 API churn | Exact pins; upgrade is a separate, reviewed change; `effect-schema` entrypoint avoided entirely |
| Generated baseline diverges from the deployed table | Introspection diff in batch 0; existing D1 suites run against the generated file |
| Drizzle-emitted SQL differs in ways tests miss | Real-runtime suites (Miniflare D1, workerd evidence harness) and the scripted smoke run are the acceptance gate |
| DO test stub drifts from the real storage interface | Stub is typed against the global `DurableObjectStorage`; a compile failure surfaces on any interface change |
| Bundle growth in workers/Nuxt | Measured in batch 4 with dry-run sizes; no assumption of neutrality |
| Preview data loss during reset | Data-only export/import is the default; wiping is an explicit operator choice |
| Two schema sources for evidence tables (schema module vs constructor DDL) | Accepted asymmetry; the workerd/unit suites prove the DDL matches the typed queries |

## Sources

- Kysely dialect landscape: <https://www.kysely.dev/docs/dialects>; `kysely-d1` driver source (no transactions, no batch); `kysely-do` driver source (pre-release, transactions throw).
- Drizzle entrypoints and signatures in `drizzle-orm@1.0.0-rc.4`: `d1/driver.d.ts`, `d1/session.d.ts`, `durable-sqlite/driver.d.ts`, `durable-sqlite/session.d.ts`, `node-sqlite/session.d.ts`, `node-sqlite/driver.d.ts`, `sqlite-core/table.d.ts`, `sql/core` `Query` type, `sqlite-core/query-builders/select.d.ts` (`toSQL`).
- Drizzle D1 batch semantics: <https://orm.drizzle.team/docs/sqlite/batch-api>; wrangler + drizzle-kit flow: <https://orm.drizzle.team/docs/drizzle-config-file>, <https://orm.drizzle.team/docs/sqlite/drizzle-kit-generate>; v1 folder layout (no journal; `<timestamp>_<name>/migration.sql`): <https://orm.drizzle.team/docs/v0-v1-changes>.
- Cloudflare: DO SQL transactions (`sql.exec` cannot run `BEGIN`; use `transactionSync`): <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>; D1 migrations: <https://developers.cloudflare.com/d1/reference/migrations>.
- Effect-schema incompatibility: <https://github.com/drizzle-team/drizzle-orm/issues/6412>.
- Repo: `workers/briefing/wrangler.jsonc` (`migrations_dir`), `docs/operations/releases-and-recovery.md` (migration rules), `README.md` (snapshot moving, checks).
