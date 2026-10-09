import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

const MIGRATION_FOLDER = /^\d{14}_[a-z0-9_-]+$/i;
const BREAKPOINT = '--> statement-breakpoint';
const SnapshotMetadata = Schema.Struct({
  version: Schema.Literal('7'),
  dialect: Schema.Literal('sqlite'),
  id: Schema.String,
  prevIds: Schema.Array(Schema.String),
  ddl: Schema.Array(Schema.Unknown),
  renames: Schema.Array(Schema.Unknown),
});
const MigrationBundle = Schema.Record(Schema.String, Schema.String);
const BOOTSTRAP_PREFIXES = [
  'CREATE TABLE `evidence_chunks` ',
  'CREATE TABLE `evidence_records` ',
  'CREATE INDEX `evidence_expiry_index` ',
];

function bootstrapSql(source: string): string {
  const remaining = new Set(BOOTSTRAP_PREFIXES);
  const statements = source.split(BREAKPOINT);
  if (statements.length !== remaining.size) throw new Error('Unexpected evidence bootstrap statement count');
  return statements
    .map((statement) => {
      const body = statement.trimStart();
      let matched: string | undefined;
      for (const prefix of remaining) {
        if (body.startsWith(prefix)) {
          matched = prefix;
          break;
        }
      }
      if (matched === undefined) throw new Error('Unexpected or duplicate evidence bootstrap statement');
      remaining.delete(matched);
      const create = matched.startsWith('CREATE TABLE ') ? 'CREATE TABLE ' : 'CREATE INDEX ';
      return statement.slice(0, statement.length - body.length) + body.replace(create, `${create}IF NOT EXISTS `);
    })
    .join(BREAKPOINT);
}

async function existingBundle(
  outputPath: string,
): Promise<{ text: string; migrations: Record<string, string> } | undefined> {
  try {
    if (!(await lstat(outputPath)).isFile()) throw new Error('Migration bundle path is not a regular file');
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') return undefined;
    throw cause;
  }
  const text = await readFile(outputPath, 'utf8');
  const migrations = Schema.decodeUnknownSync(MigrationBundle)(JSON.parse(text));
  const names = Object.keys(migrations);
  if (names.length === 0 || names.some((name) => !MIGRATION_FOLDER.test(name))) {
    throw new Error('Malformed existing evidence migration history');
  }
  return { text, migrations };
}

async function readGeneratedSql(directory: string, name: string): Promise<string> {
  const files = await readdir(directory, { withFileTypes: true });
  if (
    files.length !== 2 ||
    files.some((file) => !file.isFile() || (file.name !== 'migration.sql' && file.name !== 'snapshot.json'))
  )
    throw new Error(`Malformed generated migration folder: ${name}`);
  Schema.decodeUnknownSync(SnapshotMetadata)(JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8')));
  const sql = await readFile(join(directory, 'migration.sql'), 'utf8');
  if (sql.trim().length === 0) throw new Error(`Empty generated migration: ${name}`);
  return sql;
}

async function generatedBundle(
  sourceDirectory: string,
  bootstrapName: string | undefined,
): Promise<Record<string, string>> {
  const entries = (await readdir(sourceDirectory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const first = entries[0];
  if (first === undefined) throw new Error('Generated evidence migration history is empty');
  if (bootstrapName !== undefined && first.name !== bootstrapName)
    throw new Error('Evidence bootstrap identity changed');
  const migrations: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isDirectory() || !MIGRATION_FOLDER.test(entry.name))
      throw new Error(`Unrecognized generated entry: ${entry.name}`);
    const sql = await readGeneratedSql(join(sourceDirectory, entry.name), entry.name);
    migrations[entry.name] = entry.name === first.name ? bootstrapSql(sql) : sql;
  }
  return migrations;
}

function validateHistory(
  migrations: Record<string, string>,
  previous: Record<string, string>,
  names: readonly string[],
): void {
  for (const name of names) {
    if (!(name in migrations)) throw new Error(`Applied evidence migration removed: ${name}`);
    if (previous[name] !== migrations[name]) throw new Error(`Applied evidence migration changed: ${name}`);
  }
  const lastApplied = names.at(-1);
  if (lastApplied === undefined) return;
  for (const name of Object.keys(migrations)) {
    if (!(name in previous) && name <= lastApplied) throw new Error(`Backdated evidence migration: ${name}`);
  }
}

/** Bundle generated SQL for workerd; only the initial adoption is idempotent. Applied entries cannot change. */
export async function bundleEvidenceMigrations(
  sourceDirectory: string,
  outputPath: string,
  checkOnly = false,
): Promise<void> {
  const existing = await existingBundle(outputPath);
  const previous = existing?.migrations ?? {};
  const names = Object.keys(previous).sort();
  const migrations = await generatedBundle(sourceDirectory, names[0]);
  validateHistory(migrations, previous, names);
  const text = JSON.stringify(migrations, null, 2) + '\n';
  if (existing?.text === text) return;
  if (checkOnly) throw new Error('Missing or stale evidence migration bundle');
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/bundle-evidence-migrations/bundle-evidence-migrations.ts [--check]');
  }
  await bundleEvidenceMigrations(
    fileURLToPath(new URL('../../workers/evidence/drizzle/', import.meta.url)),
    fileURLToPath(new URL('../../workers/evidence/migrations.generated.json', import.meta.url)),
    args[0] === '--check',
  );
}
