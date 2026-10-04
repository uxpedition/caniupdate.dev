import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations/', import.meta.url));
const HARNESS_MODULE = 'briefing-d1-harness.js';
const HARNESS_SCRIPT = 'export default { fetch() { return new Response("test harness"); } };';

/** Install committed migrations into fresh or deliberately recreated schema, never a persisted restart. */
export async function installBriefingSchema(
  database: D1Database,
  migrationsDirectory = MIGRATIONS_DIRECTORY,
): Promise<void> {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  if (names.length === 0) throw new Error('Briefing migration history is empty');
  for (const name of names) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    // D1 exec splits on newlines, not SQL statement boundaries; preserve multiline statements with prepare.
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await database.prepare(statement).run();
    }
  }
}

/** The harness contract: one live binding plus the only teardown the runtime needs. */
export type BriefingD1 = {
  database: D1Database;
  dispose: () => Promise<void>;
};

/**
 * Open a real local D1 database whose state lives under `persistPath`. Reuse one runtime per suite and reset rows
 * explicitly; reopen the same path only to prove that a stored result survives a process-local cache reload.
 *
 * Miniflare 5 takes instance-level persistence and an explicit worker manifest; the flat `modules`/`script`/
 * `d1Databases`/`d1Persist` options of Miniflare 3/4 are rejected.
 */
export async function openBriefingD1(persistPath: string): Promise<BriefingD1> {
  const runtime = new Miniflare({
    resourcePersistencePath: persistPath,
    workers: [
      {
        config: {
          name: 'briefing-d1-harness',
          compatibilityDate: '2026-09-16',
          env: { BRIEFINGS_DB: { type: 'd1', id: 'briefing-unit-database' } },
          manifest: {
            mainModule: HARNESS_MODULE,
            modules: { [HARNESS_MODULE]: { type: 'esm', contents: HARNESS_SCRIPT } },
          },
        },
      },
    ],
  });
  try {
    const database = await runtime.getD1Database('BRIEFINGS_DB');
    await installBriefingSchema(database);
    return { database, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
