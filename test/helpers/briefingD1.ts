import { readFile } from 'node:fs/promises';

import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';

const SCHEMA_URL = new URL('../../migrations/0001_package_briefings.sql', import.meta.url);
const HARNESS_MODULE = 'briefing-d1-harness.js';
const HARNESS_SCRIPT = 'export default { fetch() { return new Response("test harness"); } };';

/** Install the authoritative migration. Idempotent, so a suite can restore a dropped table between tests. */
export async function installBriefingSchema(database: D1Database): Promise<void> {
  // `D1Database.exec()` splits on newlines and cannot run a wrapped statement, so prepare the one migration statement.
  await database.prepare(await readFile(SCHEMA_URL, 'utf8')).run();
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
