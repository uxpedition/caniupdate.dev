import type { Buffer } from 'node:buffer';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

const MIGRATION_FOLDER = /^\d{14}_[a-z0-9_-]+$/i;
const SnapshotMetadata = Schema.Struct({
  version: Schema.Literal('7'),
  dialect: Schema.Literal('sqlite'),
  id: Schema.String,
  prevIds: Schema.Array(Schema.String),
  ddl: Schema.Array(Schema.Unknown),
  renames: Schema.Array(Schema.Unknown),
});
type Migration = { name: string; sql: Buffer };

async function readGeneratedMigration(directory: string, name: string): Promise<Migration> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== 2 ||
    entries.some((entry) => !entry.isFile() || (entry.name !== 'migration.sql' && entry.name !== 'snapshot.json'))
  ) {
    throw new Error(`Malformed generated migration folder: ${name}`);
  }
  Schema.decodeUnknownSync(SnapshotMetadata)(JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8')));
  const sql = await readFile(join(directory, 'migration.sql'));
  if (sql.length === 0) throw new Error(`Generated migration is empty: ${name}`);
  return { name: `${name}.sql`, sql };
}

async function generatedMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length === 0) throw new Error('Generated migration history is empty');
  const migrations: Migration[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !MIGRATION_FOLDER.test(entry.name)) {
      throw new Error(`Unrecognized generated migration entry: ${entry.name}`);
    }
    migrations.push(await readGeneratedMigration(join(directory, entry.name), entry.name));
  }
  return migrations;
}

async function targetNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.sql')) continue;
      if (!entry.isFile()) throw new Error(`Mirrored SQL path is not a regular file: ${entry.name}`);
      names.push(entry.name);
    }
    return names;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function missingMigrations(migrations: readonly Migration[], directory: string): Promise<Migration[]> {
  const expected = new Map(migrations.map((migration) => [migration.name, migration]));
  const present = new Set(await targetNames(directory));
  for (const name of present) {
    const migration = expected.get(name);
    if (migration === undefined) throw new Error(`Unrecognized mirrored migration: ${name}`);
    if (!(await readFile(join(directory, name))).equals(migration.sql)) {
      throw new Error(`Mirrored migration differs from generated history: ${name}`);
    }
  }
  return migrations.filter((migration) => !present.has(migration.name));
}

/** Validate all history before writing missing mirrors; applied SQL is never rewritten or deleted. */
export async function syncMigrations(
  sourceDirectory: string,
  targetDirectory: string,
  checkOnly = false,
): Promise<void> {
  const migrations = await generatedMigrations(sourceDirectory);
  const missing = await missingMigrations(migrations, targetDirectory);
  if (checkOnly) {
    if (missing.length !== 0)
      throw new Error(`Missing migration mirrors: ${missing.map(({ name }) => name).join(', ')}`);
    return;
  }
  if (missing.length === 0) return;
  await mkdir(targetDirectory, { recursive: true });
  for (const migration of missing) {
    await writeFile(join(targetDirectory, migration.name), migration.sql, { flag: 'wx' });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/sync-migrations/sync-migrations.ts [--check]');
  }
  await syncMigrations(
    fileURLToPath(new URL('../../drizzle/', import.meta.url)),
    fileURLToPath(new URL('../../migrations/', import.meta.url)),
    args[0] === '--check',
  );
}
