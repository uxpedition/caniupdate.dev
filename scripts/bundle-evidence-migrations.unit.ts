import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundleEvidenceMigrations } from './bundle-evidence-migrations';

const first = '20261005000000_evidence_initial';
const second = '20261005000001_next';
const initial = await readFile(
  new URL('../drizzle-evidence/20261005055201_evidence_initial/migration.sql', import.meta.url),
  'utf8',
);
let directory: string;
let source: string;
let output: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evidence-migrations-'));
  source = join(directory, 'history');
  output = join(directory, 'bundle.json');
  await mkdir(source);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function generated(name: string, sql = initial): Promise<void> {
  await mkdir(join(source, name));
  await writeFile(join(source, name, 'migration.sql'), sql);
  await writeFile(
    join(source, name, 'snapshot.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      id: name,
      prevIds: ['00000000-0000-0000-0000-000000000000'],
      ddl: [],
      renames: [],
    }),
  );
}

async function bundled(): Promise<Record<string, string>> {
  return Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
    JSON.parse(await readFile(output, 'utf8')),
  );
}

describe('evidence migration bundle', () => {
  it('initializes fresh SQLite and adopts populated schema without changing its rows', async () => {
    await generated(first);
    await bundleEvidenceMigrations(source, output);
    const sql = (await bundled())[first];
    if (sql === undefined) throw new Error('Missing bootstrap');
    const db = new DatabaseSync(':memory:');
    try {
      for (const statement of sql.split('--> statement-breakpoint')) db.exec(statement);
      db.exec(`INSERT INTO evidence_records VALUES ('old', NULL, 1, 5);
        INSERT INTO evidence_chunks VALUES ('old', 0, '"old"');`);
      for (const statement of sql.split('--> statement-breakpoint')) db.exec(statement);
      expect(db.prepare('SELECT * FROM evidence_records').all()).toEqual([
        { key: 'old', expires_at: null, chunk_count: 1, byte_length: 5 },
      ]);
      expect(db.prepare('SELECT * FROM evidence_chunks').all()).toEqual([
        { key: 'old', chunk_index: 0, payload: '"old"' },
      ]);
      expect(
        db
          .prepare("PRAGMA index_list('evidence_records')")
          .all()
          .find((row) => row.name === 'evidence_expiry_index'),
      ).toMatchObject({ partial: 1 });
    } finally {
      db.close();
    }
  });

  it('appends strict migrations while preserving all bundled history', async () => {
    await generated(first);
    await bundleEvidenceMigrations(source, output);
    const before = await bundled();
    const next = 'CREATE TABLE strict_follow_on (id TEXT);\n';
    await generated(second, next);
    await bundleEvidenceMigrations(source, output);
    expect(await bundled()).toEqual({ ...before, [second]: next });
    await bundleEvidenceMigrations(source, output, true);
  });

  it.each(['changed', 'removed', 'renamed', 'backdated'])(
    'rejects %s history before changing the bundle',
    async (kind) => {
      await generated(first);
      await generated(second, 'CREATE TABLE next (id TEXT);\n');
      await bundleEvidenceMigrations(source, output);
      const before = await readFile(output, 'utf8');
      if (kind === 'changed')
        await writeFile(join(source, first, 'migration.sql'), initial.replace('byte_length', 'other_length'));
      if (kind === 'removed' || kind === 'renamed') await rm(join(source, first), { recursive: true });
      if (kind === 'renamed') await generated('20261005000000_renamed');
      if (kind === 'backdated') await generated('20261004000000_earlier');
      await expect(bundleEvidenceMigrations(source, output)).rejects.toThrow();
      expect(await readFile(output, 'utf8')).toBe(before);
    },
  );

  it('rejects inserted historical migrations even after the bootstrap', async () => {
    await generated(first);
    await generated('20261005000003_later', 'CREATE TABLE later (id TEXT);');
    await bundleEvidenceMigrations(source, output);
    const before = await readFile(output, 'utf8');
    await generated(second, 'CREATE TABLE inserted (id TEXT);');
    await expect(bundleEvidenceMigrations(source, output)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe(before);
  });

  it.each(['unsupported', 'duplicate', 'missing snapshot', 'bad snapshot', 'empty history', 'nonregular SQL'])(
    'rejects %s before publication',
    async (kind) => {
      await generated(first);
      if (kind === 'unsupported')
        await writeFile(join(source, first, 'migration.sql'), initial.replace('CREATE INDEX', 'DROP INDEX'));
      if (kind === 'duplicate')
        await writeFile(
          join(source, first, 'migration.sql'),
          initial.replace('CREATE TABLE `evidence_records`', 'CREATE TABLE `evidence_chunks`'),
        );
      if (kind === 'missing snapshot') await rm(join(source, first, 'snapshot.json'));
      if (kind === 'bad snapshot') await writeFile(join(source, first, 'snapshot.json'), '{"version":"6"}');
      if (kind === 'empty history') await rm(join(source, first), { recursive: true });
      if (kind === 'nonregular SQL') {
        await rm(join(source, first, 'migration.sql'));
        await mkdir(join(source, first, 'migration.sql'));
      }
      await expect(bundleEvidenceMigrations(source, output)).rejects.toThrow();
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('check-only does not create a missing bundle or update a stale bundle', async () => {
    await generated(first);
    await expect(bundleEvidenceMigrations(source, output, true)).rejects.toThrow();
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    await bundleEvidenceMigrations(source, output);
    const before = await readFile(output, 'utf8');
    await generated(second, 'CREATE TABLE next (id TEXT);');
    await expect(bundleEvidenceMigrations(source, output, true)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe(before);
  });

  it.each(['directory', 'symlink'])('rejects a %s occupying the bundle path', async (kind) => {
    await generated(first);
    if (kind === 'directory') await mkdir(output);
    else {
      const victim = join(directory, 'victim');
      await writeFile(victim, 'untouched');
      await symlink(victim, output);
    }
    await expect(bundleEvidenceMigrations(source, output)).rejects.toThrow();
    if (kind === 'symlink') expect(await readFile(join(directory, 'victim'), 'utf8')).toBe('untouched');
  });
});
