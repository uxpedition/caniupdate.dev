import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { syncMigrations } from './sync-migrations';

let directory: string;

let source: string;

let target: string;

const first = '20261004000000_initial';

const second = '20261004000001_next';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'migration-mirror-'));
  source = join(directory, 'drizzle');
  target = join(directory, 'migrations');
  await mkdir(source);
  await mkdir(target);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function generated(name: string, sql: string): Promise<void> {
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

describe('migration mirror safety', () => {
  it('refuses changed applied SQL without overwriting it', async () => {
    await generated(first, 'CREATE TABLE example (id TEXT);\n');
    const applied = 'CREATE TABLE example (id INTEGER);\n';
    await writeFile(join(target, `${first}.sql`), applied);

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readFile(join(target, `${first}.sql`), 'utf8')).toBe(applied);
  });

  it('refuses stale historical files without deleting them', async () => {
    await generated(first, 'CREATE TABLE example (id TEXT);\n');
    const old = 'CREATE TABLE old_history (id TEXT);\n';
    await writeFile(join(target, '0001_package_briefings.sql'), old);

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readdir(target)).toEqual(['0001_package_briefings.sql']);
    expect(await readFile(join(target, '0001_package_briefings.sql'), 'utf8')).toBe(old);
  });

  it('does not create missing mirrors in check-only mode', async () => {
    await generated(first, 'CREATE TABLE example (id TEXT);\n');

    await expect(syncMigrations(source, target, true)).rejects.toThrow();
    expect(await readdir(target)).toEqual([]);
  });

  it('validates all applied history before creating any missing mirror', async () => {
    await generated(first, 'CREATE TABLE example (id TEXT);\n');
    await generated(second, 'ALTER TABLE example ADD name TEXT;\n');
    const applied = 'ALTER TABLE example ADD other TEXT;\n';
    await writeFile(join(target, `${second}.sql`), applied);

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readdir(target)).toEqual([`${second}.sql`]);
    expect(await readFile(join(target, `${second}.sql`), 'utf8')).toBe(applied);
  });

  it('rejects malformed generator layout instead of accepting an empty history', async () => {
    await generated('not-a-timestamp', 'CREATE TABLE example (id TEXT);\n');

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readdir(target)).toEqual([]);
  });

  it('refuses missing snapshot metadata even when every SQL mirror matches', async () => {
    const sql = 'CREATE TABLE example (id TEXT);\n';
    await generated(first, sql);
    await writeFile(join(target, `${first}.sql`), sql);
    await rm(join(source, first, 'snapshot.json'));

    await expect(syncMigrations(source, target, true)).rejects.toThrow();
    expect(await readFile(join(target, `${first}.sql`), 'utf8')).toBe(sql);
  });

  it.each(['{', '{"version":"6","dialect":"sqlite"}'])(
    'refuses malformed or unsupported snapshot metadata: %s',
    async (metadata) => {
      await generated(first, 'CREATE TABLE example (id TEXT);\n');
      await writeFile(join(source, first, 'snapshot.json'), metadata);

      await expect(syncMigrations(source, target)).rejects.toThrow();
      expect(await readdir(target)).toEqual([]);
    },
  );

  it('rejects an occupied later SQL path before writing an earlier missing migration', async () => {
    await generated(first, 'CREATE TABLE example (id TEXT);\n');
    await generated(second, 'ALTER TABLE example ADD name TEXT;\n');
    await mkdir(join(target, `${second}.sql`));

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readdir(target)).toEqual([`${second}.sql`]);
  });

  it('rejects an empty generated history without changing existing SQL', async () => {
    const applied = 'CREATE TABLE example (id TEXT);\n';
    await writeFile(join(target, `${first}.sql`), applied);

    await expect(syncMigrations(source, target)).rejects.toThrow();
    expect(await readFile(join(target, `${first}.sql`), 'utf8')).toBe(applied);
  });
});
