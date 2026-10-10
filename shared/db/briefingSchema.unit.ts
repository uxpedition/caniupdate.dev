import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { installBriefingSchema, openBriefingD1 } from '../../test/helpers/briefingDatabase.harness';

const isScalarString = Schema.is(Schema.String);

const migrationsDirectory = new URL('../../migrations/', import.meta.url);

async function openSchema(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');

  try {
    const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();

    for (const name of names) {
      const sql = await readFile(new URL(name, migrationsDirectory), 'utf8');

      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim() !== '') database.exec(statement);
      }
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

describe('generated briefing schema', () => {
  it('enforces the existing key, nullability and timestamp-default contract', async () => {
    const database = await openSchema();

    try {
      expect(database.prepare('PRAGMA table_info(package_briefings)').all()).toEqual([
        { cid: 0, name: 'evidence_hash', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: 'response_json', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: 'created_at', type: 'TEXT', notnull: 1, dflt_value: 'CURRENT_TIMESTAMP', pk: 0 },
      ]);
      expect(() =>
        database.prepare('INSERT INTO package_briefings (evidence_hash, response_json) VALUES (NULL, ?)').run('{}'),
      ).toThrow();
      expect(() =>
        database
          .prepare('INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, NULL)')
          .run('invalid'),
      ).toThrow();
      database.prepare('INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?)').run('valid', '{}');

      const createdAt = database
        .prepare('SELECT created_at FROM package_briefings WHERE evidence_hash = ?')
        .get('valid')?.created_at;

      if (!isScalarString(createdAt)) throw new Error('Missing default timestamp');
      expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(database.prepare('PRAGMA foreign_key_list(package_briefings)').all()).toEqual([]);
      expect(database.prepare('PRAGMA index_list(package_briefings)').all()).toEqual([
        { seq: 0, name: 'sqlite_autoindex_package_briefings_1', unique: 1, origin: 'pk', partial: 0 },
      ]);
    } finally {
      database.close();
    }
  });

  it('installs ordered multiline migrations and every breakpoint-delimited statement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'briefing-migrations-'));

    try {
      const runtime = await openBriefingD1(join(directory, 'state'));

      try {
        await writeFile(
          join(directory, '20261005000000_later.sql'),
          `
ALTER TABLE installer_items ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE installer_items SET label = 'second migration' WHERE id = 7;
`,
        );
        await writeFile(
          join(directory, '20261004000000_initial.sql'),
          `
CREATE TABLE installer_items (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO installer_items (id, label) VALUES (7, 'first migration');
`,
        );
        await writeFile(join(directory, 'ignored.txt'), 'INVALID SQL');

        await installBriefingSchema(runtime.database, directory);
        expect(await runtime.database.prepare('SELECT id, label, enabled FROM installer_items').first()).toEqual({
          id: 7,
          label: 'second migration',
          enabled: 1,
        });
      } finally {
        await runtime.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
