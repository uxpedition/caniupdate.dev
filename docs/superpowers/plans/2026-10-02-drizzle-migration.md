# Drizzle Database Layer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every raw SQL statement in the D1 briefing store, the evidence Durable Object cache, and the offline briefing exporter with Drizzle ORM, and make drizzle-kit the schema generator while wrangler stays the only migration applier.

**Architecture:** Schema-as-code in `shared/db/` drives both queries and (for D1) generated SQL. drizzle-kit writes v1 folder-layout migrations under `drizzle/`; `scripts/sync-migrations.ts` mirrors each `<timestamp>_<name>/migration.sql` into the flat `migrations/<timestamp>_<name>.sql` files wrangler applies in filename order. D1 uses the async `drizzle-orm/d1` driver with `db.batch()` for the first-writer-wins atomicity; the evidence DO uses the synchronous `drizzle-orm/durable-sqlite` session; the exporter uses `drizzle-orm/node-sqlite` only for `.toSQL()` and keeps `DatabaseSync.iterate()` streaming.

**Tech Stack:** TypeScript 6, Nuxt 4 / Nitro, Cloudflare Workers (workerd), D1, Durable Objects SQLite, `drizzle-orm@1.0.0-rc.4`, `drizzle-kit@1.0.0-rc.4`, Effect `4.0.0-rc.115` (Schema only), Vitest, Miniflare, nub.

**Spec:** `docs/superpowers/specs/2026-10-02-drizzle-migration-design.md`

## Global Constraints

- Pin `drizzle-orm` and `drizzle-kit` to exactly `1.0.0-rc.4` (nub saves exact versions; verify `package.json` shows the bare version, not a range).
- Never import `drizzle-orm/effect-schema`. Effect stays pinned at `4.0.0-rc.115` and Effect Schema remains the validation layer.
- No type assertions anywhere, including tests (`typescript/consistent-type-assertions: never`), and no `any` (`typescript/no-explicit-any`).
- Wrangler remains the only migration applier; drizzle-kit only generates. Never edit generated or already-applied migration files.
- Public signatures of `readStoredBriefing` / `saveBriefing` stay `(database: D1Database, …)`. `BriefingJob` and the Nuxt route do not change.
- `SqlEvidenceCache` public methods stay synchronous; its constructor takes `DurableObjectStorage`.
- Raw SQL is allowed only in: the evidence-table constructor DDL (inside `sql` templates), test fixture/fault-injection code, and the exporter's execution (`DatabaseSync`). All production query construction goes through Drizzle.
- Commands: run scripts with `nub run --node <script>`; run a single test file with `nub exec -- vitest run <file>`; format changed files with `nub exec -- oxfmt <paths> --write`.
- Keep files under 400 lines, complexity ≤ 10, functions ≤ 40 lines (lint).

---

### Task 1: Schema source of truth, migration generator, and history reset

**Files:**
- Modify: `package.json` (dependency + `db:generate` script)
- Create: `shared/db/briefingSchema.ts`
- Create: `shared/db/evidenceSchema.ts`
- Create: `drizzle.config.ts`
- Create: `scripts/sync-migrations.ts`
- Test: `scripts/sync-migrations.unit.ts` (new)
- Create (generated, committed): `drizzle/<YYYYMMDDHHMMSS>_package_briefings/{migration.sql,snapshot.json}`
- Create (generated, committed): `migrations/<YYYYMMDDHHMMSS>_package_briefings.sql`
- Delete: `migrations/0001_package_briefings.sql`
- Modify: `test/helpers/briefingDatabase.harness.ts`
- Modify: `workers/briefing/test/worker.harness.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `packageBriefings`, `evidenceRecords`, `evidenceChunks` Drizzle table objects; `syncMigrations(source?, target?): Promise<{ written: readonly string[] }>`.

- [ ] **Step 1: Record pre-migration bundle sizes**

Run: `NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run --node build`
Expected: success; copy the wrangler `Total Upload` sizes for the evidence worker and briefing worker, and the Nuxt build output size, into a scratch note for Task 5.

- [ ] **Step 2: Add the pinned dependencies**

Run:
```bash
nub add drizzle-orm@1.0.0-rc.4
nub add -D drizzle-kit@1.0.0-rc.4
```
Expected: `package.json` shows `"drizzle-orm": "1.0.0-rc.4"` and `"drizzle-kit": "1.0.0-rc.4"` (exact, no `^`).

- [ ] **Step 3: Create the D1 schema module**

Create `shared/db/briefingSchema.ts`:
```ts
import { sql } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Primary keys are declared at table level on purpose: column-level .primaryKey() drops NOT NULL from generated
// SQLite DDL, while primaryKey({ columns }) emits `text PRIMARY KEY NOT NULL`, matching migrations/.
export const packageBriefings = sqliteTable(
  'package_briefings',
  {
    evidenceHash: text('evidence_hash').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({ pk: primaryKey({ columns: [table.evidenceHash] }) }),
);
```

- [ ] **Step 4: Create the DO schema module**

Create `shared/db/evidenceSchema.ts`:
```ts
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Durable Objects have no wrangler migration path: these tables are created by the SqlEvidenceCache constructor.
export const evidenceRecords = sqliteTable(
  'evidence_records',
  {
    key: text('key').notNull(),
    expiresAt: integer('expires_at'),
    chunkCount: integer('chunk_count').notNull(),
    byteLength: integer('byte_length').notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.key] }) }),
);

export const evidenceChunks = sqliteTable(
  'evidence_chunks',
  {
    key: text('key').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    payload: text('payload').notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.key, table.chunkIndex] }) }),
);
```

- [ ] **Step 5: Create the drizzle-kit config**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './shared/db/briefingSchema.ts',
  out: './drizzle',
});
```

- [ ] **Step 6: Add the generation script**

Modify `package.json` scripts (keep alphabetical order used by the file):
```json
"db:generate": "drizzle-kit generate && node scripts/sync-migrations.ts",
```

- [ ] **Step 7: Write the failing sync test**

Create `scripts/sync-migrations.unit.ts`:
```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { syncMigrations } from './sync-migrations';

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sync-migrations-'));
  directories.push(directory);
  return { source: join(directory, 'drizzle'), target: join(directory, 'migrations') };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('syncMigrations', () => {
  it('mirrors drizzle folders into flat wrangler migrations and is idempotent', async () => {
    const { source, target } = await fixture();
    await mkdir(join(source, '20260101000000_first'), { recursive: true });
    await writeFile(join(source, '20260101000000_first', 'migration.sql'), 'CREATE TABLE a (id text);');

    const first = await syncMigrations(source, target);
    expect(first.written).toEqual(['20260101000000_first.sql']);
    expect(await readFile(join(target, '20260101000000_first.sql'), 'utf8')).toBe('CREATE TABLE a (id text);');

    const second = await syncMigrations(source, target);
    expect(second.written).toEqual([]);
  });

  it('refuses stale flat migrations without a drizzle source', async () => {
    const { source, target } = await fixture();
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(target, '0001_handwritten.sql'), 'CREATE TABLE old (id text);');

    await expect(syncMigrations(source, target)).rejects.toThrow('Stale flat migrations');
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `nub exec -- vitest run scripts/sync-migrations.unit.ts`
Expected: FAIL — cannot resolve `./sync-migrations`.

- [ ] **Step 9: Implement the sync script**

Create `scripts/sync-migrations.ts`:
```ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SOURCE = fileURLToPath(new URL('../drizzle/', import.meta.url));
const DEFAULT_TARGET = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * Mirror drizzle-kit's per-migration folders into the flat *.sql files wrangler applies in filename order.
 * Folder names are timestamp-prefixed, so lexicographic order is chronological order. Stale flat files fail loudly
 * instead of silently applying history drizzle-kit no longer knows about.
 */
export async function syncMigrations(
  source = DEFAULT_SOURCE,
  target = DEFAULT_TARGET,
): Promise<{ readonly written: readonly string[] }> {
  const folders = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const expected = new Map<string, string>();
  for (const folder of folders) {
    expected.set(`${folder}.sql`, await readFile(join(source, folder, 'migration.sql'), 'utf8'));
  }

  const targetEntries = await readdir(target).catch(() => undefined);
  const stale = (targetEntries ?? []).filter((name) => name.endsWith('.sql') && !expected.has(name));
  if (stale.length > 0) throw new Error(`Stale flat migrations without a drizzle source: ${stale.join(', ')}`);

  await mkdir(target, { recursive: true });
  const written: string[] = [];
  for (const [name, sql] of expected) {
    const path = join(target, name);
    const current = await readFile(path, 'utf8').catch(() => undefined);
    if (current !== sql) {
      await writeFile(path, sql);
      written.push(name);
    }
  }
  return { written };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { written } = await syncMigrations();
  console.log(written.length === 0 ? 'Migration mirror is up to date.' : `Synced ${written.join(', ')}`);
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `nub exec -- vitest run scripts/sync-migrations.unit.ts`
Expected: PASS (2 tests).

- [ ] **Step 11: Delete the hand-written migration**

Run: `git rm migrations/0001_package_briefings.sql`
Expected: file removed from disk and index. (Deleting before generation keeps the sync script's stale check meaningful.)

- [ ] **Step 12: Generate the baseline**

Run: `nub exec -- drizzle-kit generate --name package_briefings`
Expected: `[✓] Your SQL migration ➜ drizzle/<timestamp>_package_briefings/migration.sql`.

- [ ] **Step 13: Inspect the generated baseline**

Run: `cat drizzle/*/migration.sql`
Expected (exact shape; whitespace may differ):
```sql
CREATE TABLE `package_briefings` (
	`evidence_hash` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```
The `PRIMARY KEY NOT NULL` presence is the point of the table-level primary key. If it is missing, stop and fix `briefingSchema.ts` before continuing.

- [ ] **Step 14: Mirror the migration**

Run: `nub --node scripts/sync-migrations.ts`
Expected: `Synced <timestamp>_package_briefings.sql`.

- [ ] **Step 15: Rehearsal — prove schema equivalence with the old migration**

Create `/tmp/migration-equivalence.mjs` (throwaway; do not commit):
```js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const normalize = (sql) => sql.replace(/[`"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const inspect = (path) => {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(path, 'utf8'));
  const create = database
    .prepare("select sql from sqlite_master where type = 'table' and name = 'package_briefings'")
    .get().sql;
  const columns = database
    .prepare("pragma table_info('package_briefings')")
    .all()
    .map((column) => [column.name, column.type, column.notnull, column.pk, column.dflt_value ?? ''].join('|'))
    .join('\n');
  const indexes = database
    .prepare("pragma index_list('package_briefings')")
    .all()
    .map((index) => `${index.name}|${index.unique}|${index.partial}`)
    .join('\n');
  return `${normalize(create)}\n${columns}\n${indexes}`;
};

const [oldPath, newPath] = process.argv.slice(2);
const oldSchema = inspect(oldPath);
const newSchema = inspect(newPath);
if (oldSchema !== newSchema) {
  console.error(`SCHEMA MISMATCH\n--- old ---\n${oldSchema}\n--- new ---\n${newSchema}`);
  process.exit(1);
}
console.log('schema equivalent');
```
Run:
```bash
git show HEAD:migrations/0001_package_briefings.sql > /tmp/migration-equivalence-old.sql
node /tmp/migration-equivalence.mjs /tmp/migration-equivalence-old.sql "$(ls migrations/*.sql)"
```
Expected: `schema equivalent`. If it fails, fix `briefingSchema.ts`, regenerate, and repeat; record the output in the commit message.

Then restore the extra imports in `scripts/sync-migrations.unit.ts` (`import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';` and `import { fileURLToPath } from 'node:url';`) and append the committed-mirror drift test:
```ts
  it('keeps the committed flat mirror in sync with the drizzle folders', async () => {
    const source = fileURLToPath(new URL('../drizzle/', import.meta.url));
    const target = fileURLToPath(new URL('../migrations/', import.meta.url));
    const folders = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const expected = new Map<string, string>();
    for (const folder of folders) {
      expected.set(`${folder}.sql`, await readFile(join(source, folder, 'migration.sql'), 'utf8'));
    }
    const actual = new Map<string, string>();
    for (const name of (await readdir(target)).filter((entry) => entry.endsWith('.sql'))) {
      actual.set(name, await readFile(join(target, name), 'utf8'));
    }

    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [name, sql] of expected) expect(actual.get(name)).toBe(sql);
  });
```
Run: `nub exec -- vitest run scripts/sync-migrations.unit.ts`
Expected: PASS (3 tests) — this is the permanent guard against a forgotten `db:generate` run.

- [ ] **Step 16: Prove regeneration is a no-op**

Run: `nub run --node db:generate`
Expected: `No schema changes, nothing to migrate 😴` followed by `Migration mirror is up to date.`

- [ ] **Step 17: Update the standalone D1 harness**

Modify `test/helpers/briefingDatabase.harness.ts`: replace the `readFile`-only import with `readFile, readdir`, replace `SCHEMA_URL` and `installBriefingSchema` with:
```ts
const MIGRATIONS_URL = new URL('../../migrations/', import.meta.url);
const STATEMENT_SEPARATOR = '--> statement-breakpoint';

/**
 * Run every committed migration in filename order, the same order wrangler applies them, so a dropped table can be
 * restored between tests. The helper replays migration history; it is not idempotent against partially migrated state.
 */
export async function installBriefingSchema(database: D1Database): Promise<void> {
  const names = (await readdir(MIGRATIONS_URL)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    const contents = await readFile(new URL(name, MIGRATIONS_URL), 'utf8');
    for (const statement of contents.split(STATEMENT_SEPARATOR)) {
      const sql = statement.trim();
      if (sql !== '') await database.prepare(sql).run();
    }
  }
}
```

- [ ] **Step 18: Update the briefing-worker harness**

Modify `workers/briefing/test/worker.harness.ts`: replace `const MIGRATION_PATH = join(REPO_ROOT, 'migrations', '0001_package_briefings.sql');` with `const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations');` and replace `installBriefingSchema` with (readdir is already imported in this file):
```ts
const STATEMENT_SEPARATOR = '--> statement-breakpoint';

/**
 * Run every committed migration in filename order, the same order wrangler applies them, so a dropped table can be
 * restored between tests. The helper replays migration history; it is not idempotent against partially migrated state.
 */
export async function installBriefingSchema(database: D1Database): Promise<void> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    const contents = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    for (const statement of contents.split(STATEMENT_SEPARATOR)) {
      const sql = statement.trim();
      if (sql !== '') await database.prepare(sql).run();
    }
  }
}
```

- [ ] **Step 19: Run the full suite**

Run: `nub run --node test`
Expected: all suites pass; the briefing store and job suites now apply the generated migration through both harnesses.

- [ ] **Step 20: Reset local D1 state and apply the generated baseline**

Stop any running `dev`/`preview` launcher, then:
```bash
rm -rf .wrangler/state
nub run --node db:migrate:local
```
Expected: wrangler applies `<timestamp>_package_briefings.sql`; `.wrangler/state/v3/d1` is recreated.

- [ ] **Step 21: Commit**

```bash
git add package.json nub.lock shared/db drizzle.config.ts scripts/sync-migrations.ts scripts/sync-migrations.unit.ts
git commit -m "feat: add drizzle schema modules and migration generator"
git add migrations drizzle test/helpers/briefingDatabase.harness.ts workers/briefing/test/worker.harness.ts
git commit -m "feat: generate the briefing schema from drizzle and reset migration history"
```

---

### Task 2: D1 briefing store through Drizzle

**Files:**
- Modify: `server/utils/packageBriefingStore.ts` (whole file)
- Test: `server/utils/packageBriefingStore.unit.ts` (unchanged; must stay green)

**Interfaces:**
- Consumes: `packageBriefings` from Task 1.
- Produces: unchanged public API — `readStoredBriefing(database, evidenceHash)`, `saveBriefing(database, evidenceHash, briefing)`, `BriefingStoreError`, `BriefingStoreCorruptionError`, `BriefingStoreValidationError`, `BriefingStoreFailure`, `isBriefingStoreFailure`.

- [ ] **Step 1: Confirm the existing suite is green before the change**

Run: `nub exec -- vitest run server/utils/packageBriefingStore.unit.ts`
Expected: PASS (4 tests).

- [ ] **Step 2: Rewrite the store**

Replace `server/utils/packageBriefingStore.ts` with:
```ts
import type { D1Database } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Data, Schema } from 'effect';

import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../../shared/briefing.defs';
import { packageBriefings } from '../../shared/db/briefingSchema';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);

export const BriefingStoreError = Data.TaggedError('BriefingStoreError')<{
  readonly operation: 'read' | 'write';
  readonly cause: unknown;
}>;

export const BriefingStoreCorruptionError = Data.TaggedError('BriefingStoreCorruptionError')<{
  readonly cause: unknown;
}>;

export const BriefingStoreValidationError = Data.TaggedError('BriefingStoreValidationError')<{
  readonly cause: unknown;
}>;

export type BriefingStoreFailure =
  | InstanceType<typeof BriefingStoreError>
  | InstanceType<typeof BriefingStoreCorruptionError>
  | InstanceType<typeof BriefingStoreValidationError>;

export const isBriefingStoreFailure = (cause: unknown): cause is BriefingStoreFailure =>
  cause instanceof BriefingStoreError ||
  cause instanceof BriefingStoreCorruptionError ||
  cause instanceof BriefingStoreValidationError;

function decodeRow(value: unknown): AvailablePackageBriefing {
  try {
    if (typeof value !== 'string') throw new TypeError('Stored briefing is not JSON text');
    return decodeBriefing(JSON.parse(value));
  } catch (cause) {
    throw new BriefingStoreCorruptionError({ cause });
  }
}

/**
 * Read the snapshot stored for an evidence hash. The table is installed by the generated migration, so a missing
 * schema or binding surfaces as a rejection rather than an empty cache.
 */
export async function readStoredBriefing(
  database: D1Database,
  evidenceHash: string,
): Promise<AvailablePackageBriefing | undefined> {
  let row: { responseJson: string } | undefined;
  try {
    row = await drizzle(database)
      .select({ responseJson: packageBriefings.responseJson })
      .from(packageBriefings)
      .where(eq(packageBriefings.evidenceHash, evidenceHash))
      .get();
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'read', cause });
  }
  return row === undefined ? undefined : decodeRow(row.responseJson);
}

/** Keep the first validated success for a snapshot; the insert/select batch returns that winner to every caller. */
export async function saveBriefing(
  database: D1Database,
  evidenceHash: string,
  briefing: AvailablePackageBriefing,
): Promise<AvailablePackageBriefing> {
  let validated: AvailablePackageBriefing;
  try {
    validated = decodeBriefing(briefing);
  } catch (cause) {
    throw new BriefingStoreValidationError({ cause });
  }

  let responseJson: unknown;
  try {
    const db = drizzle(database);
    const [, selected] = await db.batch([
      db
        .insert(packageBriefings)
        .values({ evidenceHash, responseJson: JSON.stringify(validated) })
        .onConflictDoNothing(),
      db
        .select({ responseJson: packageBriefings.responseJson })
        .from(packageBriefings)
        .where(eq(packageBriefings.evidenceHash, evidenceHash)),
    ]);
    responseJson = selected[0]?.responseJson;
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'write', cause });
  }
  return decodeRow(responseJson);
}
```
`db.batch()` is one D1 `batch()` call, so the existing first-writer-wins atomicity is unchanged.

- [ ] **Step 3: Run the suite**

Run: `nub exec -- vitest run server/utils/packageBriefingStore.unit.ts`
Expected: PASS (4 tests), including `preserves one canonical success across competing writes` and the `DROP TABLE` failure-tagging test. Test fixtures keep raw `prepare` on purpose.

- [ ] **Step 4: Type-check and format**

Run:
```bash
nub run --node type-check
nub exec -- oxfmt server/utils/packageBriefingStore.ts --write
```
Expected: type-check clean (runs `nuxt typecheck` plus both worker tsconfigs).

- [ ] **Step 5: Commit**

```bash
git add server/utils/packageBriefingStore.ts
git commit -m "refactor: read and write briefings through drizzle"
```

---

### Task 3: Evidence DO cache through Drizzle

**Files:**
- Create: `workers/evidence/test/doStorageStub.ts`
- Modify: `workers/evidence/store.ts` (whole file)
- Modify: `workers/evidence/store.unit.ts` (whole file)
- Runtime under test: `workers/evidence/index.ts:61` (`new SqlEvidenceCache(ctx.storage)` — unchanged)

**Interfaces:**
- Consumes: `evidenceRecords`, `evidenceChunks` from Task 1.
- Produces: unchanged `SqlEvidenceCache` class API (`load`, `cleanupExpired`), now constructed with `DurableObjectStorage`; `DoStorageStub` and `StubCursor` for tests.

- [ ] **Step 1: Create the storage stub**

Create `workers/evidence/test/doStorageStub.ts`:
```ts
// Test-only stand-in for a SQLite-backed Durable Object storage. It satisfies the full global interface because
// drizzle's DO driver is typed against DurableObjectStorage, and the project bans type assertions.
class StubStatement {}

export class StubCursor<T extends Record<string, SqlStorageValue>> {
  next(): { done: true } {
    return { done: true };
  }
  toArray(): T[] {
    return [];
  }
  one(): T {
    throw new Error('StubCursor.one is not implemented');
  }
  raw<U extends SqlStorageValue[]>(): IterableIterator<U> {
    const empty: U[] = [];
    return empty[Symbol.iterator]();
  }
  columnNames: string[] = [];
  get rowsRead(): number {
    return 0;
  }
  get rowsWritten(): number {
    return 0;
  }
  [Symbol.iterator](): IterableIterator<T> {
    const empty: T[] = [];
    return empty[Symbol.iterator]();
  }
}

class StubKv implements SyncKvStorage {
  get<T = unknown>(_key: string): T | undefined {
    return undefined;
  }
  list<T = unknown>(_options?: SyncKvListOptions): Iterable<[string, T]> {
    const empty: [string, T][] = [];
    return empty;
  }
  put<T>(_key: string, _value: T): void {}
  delete(_key: string): boolean {
    return false;
  }
}

export class DoStorageStub implements DurableObjectStorage {
  sql: SqlStorage = {
    exec: <T extends Record<string, SqlStorageValue>>(
      _query: string,
      ..._bindings: SqlStorageValue[]
    ): SqlStorageCursor<T> => new StubCursor<T>(),
    get databaseSize(): number {
      return 0;
    },
    Cursor: StubCursor,
    Statement: StubStatement,
  };
  kv: SyncKvStorage = new StubKv();

  async get<T = unknown>(key: string, options?: DurableObjectGetOptions): Promise<T | undefined>;
  async get<T = unknown>(keys: string[], options?: DurableObjectGetOptions): Promise<Map<string, T>>;
  async get(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.get is not implemented');
  }
  async list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
  async list(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.list is not implemented');
  }
  async put<T>(key: string, value: T, options?: DurableObjectPutOptions): Promise<void>;
  async put<T>(entries: Record<string, T>, options?: DurableObjectPutOptions): Promise<void>;
  async put(..._args: unknown[]): Promise<void> {}
  async delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
  async delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
  async delete(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.delete is not implemented');
  }
  async deleteAll(options?: DurableObjectPutOptions): Promise<void>;
  async deleteAll(..._args: unknown[]): Promise<void> {}
  async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
  async transaction(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.transaction is not implemented');
  }
  async getAlarm(options?: DurableObjectGetAlarmOptions): Promise<number | null>;
  async getAlarm(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.getAlarm is not implemented');
  }
  async setAlarm(scheduledTime: number | Date, options?: DurableObjectSetAlarmOptions): Promise<void>;
  async setAlarm(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.setAlarm is not implemented');
  }
  async deleteAlarm(options?: DurableObjectSetAlarmOptions): Promise<void>;
  async deleteAlarm(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.deleteAlarm is not implemented');
  }
  async sync(): Promise<void>;
  async sync(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.sync is not implemented');
  }
  transactionSync<T>(closure: () => T): T {
    return closure();
  }
  async getCurrentBookmark(): Promise<string>;
  async getCurrentBookmark(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.getCurrentBookmark is not implemented');
  }
  async getBookmarkForTime(timestamp: number | Date): Promise<string>;
  async getBookmarkForTime(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.getBookmarkForTime is not implemented');
  }
  async onNextSessionRestoreBookmark(bookmark: string): Promise<string>;
  async onNextSessionRestoreBookmark(..._args: unknown[]): Promise<never> {
    throw new Error('DoStorageStub.onNextSessionRestoreBookmark is not implemented');
  }
}
```
This exact shape type-checks against `@cloudflare/workers-types@5.20260925.1` with the repo's strict settings; no assertions are used.

- [ ] **Step 2: Rewrite the unit tests (red first)**

Replace `workers/evidence/store.unit.ts` with:
```ts
import { describe, expect, it } from 'vitest';

import type { ComparisonEvidenceCacheOptions } from '../../server/utils/packageComparisonFacts';
import { SqlEvidenceCache } from './store';
import { DoStorageStub, StubCursor } from './test/doStorageStub';

const options = {
  ttlMs: null,
  cacheable: Boolean,
  isValid: (value: unknown): value is string => typeof value === 'string',
} satisfies ComparisonEvidenceCacheOptions<string>;

describe('evidence cache storage failures', () => {
  it('rejects construction when schema initialization fails', () => {
    const cause = new Error('SQLite initialization unavailable');
    const storage = new DoStorageStub();
    storage.sql.exec = () => {
      throw cause;
    };

    expect(() => new SqlEvidenceCache(storage)).toThrowError(
      expect.objectContaining({ _tag: 'EvidenceStorageError', operation: 'initialize', cause }),
    );
  });

  it('tags SQL read failures and does not treat them as cache misses', async () => {
    const cause = new Error('SQLite unavailable');
    const storage = new DoStorageStub();
    storage.sql.exec = <T extends Record<string, SqlStorageValue>>(query: string): SqlStorageCursor<T> => {
      if (query.startsWith('select "key"')) throw cause;
      return new StubCursor<T>();
    };
    const cache = new SqlEvidenceCache(storage);
    let loaderCalls = 0;

    await expect(
      cache.load(
        'evidence-key',
        async () => {
          loaderCalls += 1;
          return 'fresh evidence';
        },
        options,
      ),
    ).rejects.toMatchObject({ _tag: 'EvidenceStorageError', operation: 'read' });
    expect(loaderCalls).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify red**

Run: `nub exec -- vitest run workers/evidence/store.unit.ts`
Expected: the construction test passes; the read-failure test FAILS because the raw implementation's query starts with `SELECT key, expires_at` (uppercase), so the predicate does not throw and the loader runs. This red state proves the test exercises the Drizzle-generated SQL.

- [ ] **Step 4: Rewrite the cache**

Replace `workers/evidence/store.ts` with:
```ts
import { Buffer } from 'node:buffer';

import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

import type {
  ComparisonEvidenceCache,
  ComparisonEvidenceCacheOptions,
} from '../../server/utils/packageComparisonFacts';
import { EvidenceStorageCorruptionError, EvidenceStorageError } from '../../server/utils/packageEvidenceErrors';
import { evidenceChunks, evidenceRecords } from '../../shared/db/evidenceSchema';

export { EvidenceStorageCorruptionError, EvidenceStorageError };

const CHUNK_BYTES = 128 * 1024;

type RecordRow = {
  key: string;
  expiresAt: number | null;
  chunkCount: number;
  byteLength: number;
};

type CachedValue = { found: true; value: unknown } | { found: false };

const CHUNK_UTF16_UNITS = Math.floor(CHUNK_BYTES / 3);

/** SQLite-backed cache used by one PackageEvidence object. Rows and chunks are replaced atomically. */
export class SqlEvidenceCache implements ComparisonEvidenceCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly database: DrizzleSqliteDODatabase;

  constructor(storage: DurableObjectStorage) {
    try {
      this.database = drizzle(storage);
      this.database.run(sql`
        CREATE TABLE IF NOT EXISTS evidence_records (
          key TEXT PRIMARY KEY NOT NULL,
          expires_at INTEGER,
          chunk_count INTEGER NOT NULL,
          byte_length INTEGER NOT NULL
        )
      `);
      this.database.run(sql`
        CREATE TABLE IF NOT EXISTS evidence_chunks (
          key TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY (key, chunk_index)
        )
      `);
      this.database.run(
        sql`CREATE INDEX IF NOT EXISTS evidence_expiry_index ON evidence_records(expires_at) WHERE expires_at IS NOT NULL`,
      );
    } catch (cause) {
      throw new EvidenceStorageError({ operation: 'initialize', cause });
    }
  }

  async load<T>(key: string, loader: () => Promise<T>, options: ComparisonEvidenceCacheOptions<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return validateValue(await existing, options);

    this.cleanupExpired();
    const cached = this.read(key, Date.now());
    if (cached.found) return validateValue(cached.value, options);

    const pending = this.populate(key, loader, options);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  cleanupExpired(now = Date.now()): void {
    storageOperation('cleanup', () =>
      this.database.transaction((tx) => {
        tx.delete(evidenceChunks)
          .where(
            inArray(
              evidenceChunks.key,
              tx
                .select({ key: evidenceRecords.key })
                .from(evidenceRecords)
                .where(and(isNotNull(evidenceRecords.expiresAt), lte(evidenceRecords.expiresAt, now))),
            ),
          )
          .run();
        tx.delete(evidenceRecords)
          .where(and(isNotNull(evidenceRecords.expiresAt), lte(evidenceRecords.expiresAt, now)))
          .run();
      }),
    );
  }

  private async populate<T>(
    key: string,
    loader: () => Promise<T>,
    options: ComparisonEvidenceCacheOptions<T>,
  ): Promise<T> {
    const value = await loader();
    if (options.cacheable(value)) this.write(key, value, options.ttlMs);
    return value;
  }

  private read(key: string, now: number): CachedValue {
    const row = storageOperation('read', () =>
      this.database
        .select({
          key: evidenceRecords.key,
          expiresAt: evidenceRecords.expiresAt,
          chunkCount: evidenceRecords.chunkCount,
          byteLength: evidenceRecords.byteLength,
        })
        .from(evidenceRecords)
        .where(eq(evidenceRecords.key, key))
        .get(),
    );
    if (row === undefined) return { found: false };
    validateMetadata(row);
    if (row.expiresAt !== null && row.expiresAt <= now) {
      this.delete(key);
      return { found: false };
    }

    const serialized = this.readSerialized(row);
    try {
      const value: unknown = JSON.parse(serialized);
      return { found: true, value };
    } catch (cause) {
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence payload is not valid JSON', cause });
    }
  }

  private readSerialized(row: RecordRow): string {
    const chunks = storageOperation('read', () =>
      this.database
        .select({ chunkIndex: evidenceChunks.chunkIndex, payload: evidenceChunks.payload })
        .from(evidenceChunks)
        .where(eq(evidenceChunks.key, row.key))
        .orderBy(asc(evidenceChunks.chunkIndex))
        .all(),
    );
    if (chunks.length !== row.chunkCount)
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence chunks are incomplete' });
    let serialized = '';
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk === undefined || chunk.chunkIndex !== index || typeof chunk.payload !== 'string') {
        throw new EvidenceStorageCorruptionError({ detail: 'Evidence chunk order is invalid' });
      }
      serialized += chunk.payload;
    }
    if (Buffer.byteLength(serialized, 'utf8') !== row.byteLength) {
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence payload length is invalid' });
    }
    return serialized;
  }

  private write<T>(key: string, value: T, ttlMs: number | null): void {
    const serialized = storageOperation('serialize', () => JSON.stringify(value));
    if (serialized === undefined)
      throw new EvidenceStorageError({
        operation: 'serialize',
        cause: new TypeError('Evidence value cannot be serialized'),
      });
    const chunks = splitUtf8(serialized, CHUNK_BYTES);
    const expiresAt = ttlMs === null ? null : Date.now() + ttlMs;
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    storageOperation('write', () =>
      this.database.transaction((tx) => {
        tx.delete(evidenceChunks).where(eq(evidenceChunks.key, key)).run();
        tx.delete(evidenceRecords).where(eq(evidenceRecords.key, key)).run();
        tx.insert(evidenceRecords).values({ key, expiresAt, chunkCount: chunks.length, byteLength }).run();
        for (const [index, payload] of chunks.entries()) {
          tx.insert(evidenceChunks).values({ key, chunkIndex: index, payload }).run();
        }
      }),
    );
  }

  private delete(key: string): void {
    storageOperation('delete', () =>
      this.database.transaction((tx) => {
        tx.delete(evidenceChunks).where(eq(evidenceChunks.key, key)).run();
        tx.delete(evidenceRecords).where(eq(evidenceRecords.key, key)).run();
      }),
    );
  }
}

type StorageOperation = 'read' | 'write' | 'cleanup' | 'delete' | 'serialize';

function storageOperation<T>(operation: StorageOperation, run: () => T): T {
  try {
    return run();
  } catch (cause) {
    if (cause instanceof EvidenceStorageError || cause instanceof EvidenceStorageCorruptionError) throw cause;
    throw new EvidenceStorageError({ operation, cause });
  }
}

function validateValue<T>(value: unknown, options: ComparisonEvidenceCacheOptions<T>): T {
  if (!options.isValid(value))
    throw new EvidenceStorageCorruptionError({ detail: 'Evidence value does not match its schema' });
  return value;
}

function validateMetadata(row: RecordRow): void {
  if (
    !Number.isSafeInteger(row.chunkCount) ||
    row.chunkCount <= 0 ||
    !Number.isSafeInteger(row.byteLength) ||
    row.byteLength < 0 ||
    (row.expiresAt !== null && !Number.isSafeInteger(row.expiresAt))
  )
    throw new EvidenceStorageCorruptionError({ detail: 'Evidence metadata is invalid' });
}

function splitUtf8(value: string, limit: number): string[] {
  const chunks: string[] = [];
  const units = Math.min(Math.floor(limit / 3), CHUNK_UTF16_UNITS);
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + units, value.length);
    if (
      end < value.length &&
      end > start &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 &&
      value.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks.length > 0 ? chunks : [''];
}
```

- [ ] **Step 5: Run the unit tests**

Run: `nub exec -- vitest run workers/evidence/store.unit.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the evidence worker suites**

Run: `nub exec -- vitest run workers/evidence`
Expected: PASS, including the workerd tarball streaming suite that exercises the cache through the real runtime.

- [ ] **Step 7: Type-check, lint, format**

Run:
```bash
nub run --node type-check
nub exec -- oxlint workers/evidence/store.ts workers/evidence/store.unit.ts workers/evidence/test/doStorageStub.ts
nub exec -- oxfmt workers/evidence/store.ts workers/evidence/store.unit.ts workers/evidence/test/doStorageStub.ts --write
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add workers/evidence/store.ts workers/evidence/store.unit.ts workers/evidence/test/doStorageStub.ts
git commit -m "refactor: back the evidence cache with drizzle"
```

---

### Task 4: Exporter builds SQL through Drizzle

**Files:**
- Modify: `scripts/export-briefings.ts` (imports + the row-scan block)
- Test: `scripts/export-briefings.unit.ts` (unchanged; must stay green)

**Interfaces:**
- Consumes: `packageBriefings` from Task 1.
- Produces: unchanged CLI contract (`node scripts/export-briefings.ts SOURCE.sqlite OUTPUT.sql`) and identical output SQL bytes.

- [ ] **Step 1: Confirm the exporter suite is green before the change**

Run: `nub exec -- vitest run scripts/export-briefings.unit.ts`
Expected: PASS.

- [ ] **Step 2: Add imports**

In `scripts/export-briefings.ts`, add:
```ts
import { drizzle } from 'drizzle-orm/node-sqlite';

import { packageBriefings } from '../shared/db/briefingSchema.ts';
```
Keep the existing import order (run oxfmt in Step 4).

- [ ] **Step 3: Replace the row-scan block**

Replace the `for (const row of database.prepare('SELECT evidence_hash, response_json, created_at FROM package_briefings ORDER BY evidence_hash').iterate()) {` loop header and the three projections with:
```ts
  const snapshotQuery = drizzle({ client: database })
    .select({
      evidence_hash: packageBriefings.evidenceHash,
      response_json: packageBriefings.responseJson,
      created_at: packageBriefings.createdAt,
    })
    .from(packageBriefings)
    .orderBy(packageBriefings.evidenceHash)
    .toSQL();
  if (snapshotQuery.params.length > 0) throw new Error('Snapshot query must not bind parameters');
  for (const row of database.prepare(snapshotQuery.sql).iterate()) {
    const hash = row.evidence_hash;
    const response = row.response_json;
    const createdAt = row.created_at;
```
Everything inside the loop (validation, literal escaping, verbatim byte preservation) stays byte-for-byte unchanged; execution still streams through `DatabaseSync.iterate()`.

- [ ] **Step 4: Run the suite, then type-check and format**

Run:
```bash
nub exec -- vitest run scripts/export-briefings.unit.ts
nub run --node type-check
nub exec -- oxfmt scripts/export-briefings.ts --write
```
Expected: PASS; the suite asserts the emitted SQL text, so an accidental query change fails here.

- [ ] **Step 5: Commit**

```bash
git add scripts/export-briefings.ts
git commit -m "refactor: build the briefing export query with drizzle"
```

---

### Task 5: Verification and documentation

**Files:**
- Modify: `docs/operations/development.md`
- Modify: `docs/operations/releases-and-recovery.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: recorded verification evidence and updated contributor documentation; a documented, separately approved preview reset procedure.

- [ ] **Step 1: Run the full check set**

Run:
```bash
nub run --node type-check
nub run --node test
nub run --node lint:check
nub run --node format:check
```
Expected: all clean. Fix with `nub exec -- oxlint <paths> --fix` / `nub exec -- oxfmt <paths> --write` as needed, then re-run.

- [ ] **Step 2: Run the local smoke**

Ensure `workers/briefing/.dev.vars` has only the fixture values documented in `docs/operations/development.md`, then run:
```bash
node scripts/smoke.ts
```
Expected: the briefing lifecycle completes (submission, socket completion, restart, D1 reuse, reconnect). This exercises the new D1 path end to end.

- [ ] **Step 3: Measure bundles and compare with Task 1 Step 1**

Run: `NUXT_PUBLIC_SITE_URL=http://localhost:5173 nub run --node build`
Expected: success; report the evidence worker, briefing worker, and Nuxt output sizes next to the Task 1 baseline. No silent claim of neutrality.

- [ ] **Step 4: Document the generation workflow**

In `docs/operations/development.md`, next to the existing `db:migrate:local` instructions, add:
```markdown
Schema changes start in [`shared/db/briefingSchema.ts`](../../shared/db/briefingSchema.ts). Generate a migration with `nub run --node db:generate`; it writes a drizzle-kit folder under `drizzle/` and mirrors it to a flat `migrations/*.sql` file that wrangler applies. Commit both. Do not edit generated or already-applied migration files.
```
In `docs/operations/releases-and-recovery.md`, update rule 1 of "Database and stored data changes" to:
```markdown
1. Add a new generated migration for each schema change (`nub run --node db:generate`). Do not rewrite already-applied migration history.
```
In `README.md`, in the "Local D1 persistence" section, add one sentence:
```markdown
Schema is declared in `shared/db/briefingSchema.ts`; `nub run --node db:generate` produces the drizzle-kit migration and its flat `migrations/` mirror applied by wrangler.
```

- [ ] **Step 5: Commit the documentation**

```bash
git add docs/operations/development.md docs/operations/releases-and-recovery.md README.md
git commit -m "docs: document the drizzle migration workflow"
```

- [ ] **Step 6: Preview reset (reviewed ops step — do not run without explicit approval)**

Only after the code is merged and reviewed, and with the operator's explicit approval:
```bash
nub exec -- wrangler d1 export BRIEFINGS_DB --remote --env preview --no-schema --output .data/preview-briefings.sql
nub exec -- wrangler d1 execute BRIEFINGS_DB --remote --env preview --config workers/briefing/wrangler.jsonc --command "DROP TABLE package_briefings"
nub exec -- wrangler d1 execute BRIEFINGS_DB --remote --env preview --config workers/briefing/wrangler.jsonc --command "DELETE FROM d1_migrations"
nub exec -- wrangler d1 migrations apply BRIEFINGS_DB --remote --env preview --config workers/briefing/wrangler.jsonc
nub exec -- wrangler d1 execute BRIEFINGS_DB --remote --env preview --config workers/briefing/wrangler.jsonc --file .data/preview-briefings.sql
```
Verify the exact `wrangler d1 export` flags against the installed wrangler during rehearsal; if `--no-schema` is unavailable, export the full dump and import only the INSERT statements. Wiping instead of preserving preview results is an operator choice. Record applied migrations and failures per the release policy.

---

## Execution notes

- Targeted suites: `nub exec -- vitest run <path>`; full suite: `nub run --node test`.
- Type-check runs `nuxt typecheck` and both worker tsconfigs; it is the gate that catches worker/shared boundary mistakes.
- If `drizzle-kit` generation fails under plain Node, run it as `nub exec -- drizzle-kit generate --name <name>` (the repo's pinned toolchain) and report the failure instead of adding flags.
- Never keep `/tmp/migration-equivalence.mjs`; it is throwaway verification, and its output belongs in the commit message or PR.
