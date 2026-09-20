import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient, type Client } from '@libsql/client/sqlite3';
import { Schema } from 'effect';

import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../../shared/briefing.defs';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const SELECT_BRIEFING = 'SELECT response_json FROM package_briefings WHERE evidence_hash = ?';
const WRITE_RETRY_DELAYS_MS = [0, 25, 50, 100, 200, 400] as const;

type Database = { path: string; client: Client; ready: Promise<void> };
let database: Database | undefined;

/** Close the process-local connection pool on Nitro shutdown or before changing its configured file. */
export function closeBriefingStore(): void {
  database?.client.close();
  database = undefined;
}

async function getDatabase(): Promise<Client> {
  const path = resolve(process.env.AI_BRIEFING_CACHE_PATH?.trim() || '.data/briefings.db');
  if (database?.path !== path) {
    closeBriefingStore();
    mkdirSync(dirname(path), { recursive: true });
    // The local-only client cannot connect to Turso Cloud; no credentials or remote URL are accepted.
    const client = createClient({ url: pathToFileURL(path).href, timeout: 250 });
    const ready = client
      .execute(`CREATE TABLE IF NOT EXISTS package_briefings (
      evidence_hash TEXT PRIMARY KEY NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
      .then(() => {});
    database = { path, client, ready };
  }
  const current = database;
  try {
    await current.ready;
    return current.client;
  } catch (error) {
    if (database === current) closeBriefingStore();
    throw error;
  }
}

function decodeRow(value: unknown): AvailablePackageBriefing {
  if (typeof value !== 'string') throw new Error('Stored briefing is not JSON text');
  return decodeBriefing(JSON.parse(value));
}

function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const rawCode = 'rawCode' in error && typeof error.rawCode === 'number' ? error.rawCode : undefined;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || rawCode === 5 || rawCode === 6;
}

function waitForRetry(delay: number): Promise<void> {
  const result = Promise.withResolvers<void>();
  setTimeout(result.resolve, delay);
  return result.promise;
}

export async function readStoredBriefing(evidenceHash: string): Promise<AvailablePackageBriefing | undefined> {
  const client = await getDatabase();
  const result = await client.execute({ sql: SELECT_BRIEFING, args: [evidenceHash] });
  const row = result.rows[0];
  return row === undefined ? undefined : decodeRow(row.response_json);
}

/** Keep the first validated success for a snapshot, even when two server processes finish together. */
export async function saveBriefing(
  evidenceHash: string,
  briefing: AvailablePackageBriefing,
): Promise<AvailablePackageBriefing> {
  let lastError: unknown;
  for (const delay of WRITE_RETRY_DELAYS_MS) {
    if (delay > 0) await waitForRetry(delay);
    try {
      const client = await getDatabase();
      await client.execute({
        sql: 'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?) ON CONFLICT (evidence_hash) DO NOTHING',
        args: [evidenceHash, JSON.stringify(briefing)],
      });
      const result = await client.execute({ sql: SELECT_BRIEFING, args: [evidenceHash] });
      return decodeRow(result.rows[0]?.response_json);
    } catch (error) {
      lastError = error;
      if (!isBusyError(error)) throw error;
    }
  }
  throw lastError;
}
