import type { D1Database } from '@cloudflare/workers-types';
import { Schema } from 'effect';

import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../../shared/briefing.defs';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const SELECT_BRIEFING = 'SELECT response_json FROM package_briefings WHERE evidence_hash = ?';

function decodeRow(value: unknown): AvailablePackageBriefing {
  if (typeof value !== 'string') throw new Error('Stored briefing is not JSON text');
  return decodeBriefing(JSON.parse(value));
}

/**
 * Read the snapshot stored for an evidence hash. The table is installed by `migrations/0001_package_briefings.sql`, so a
 * missing schema or binding surfaces as a rejection rather than an empty cache.
 */
export async function readStoredBriefing(
  database: D1Database,
  evidenceHash: string,
): Promise<AvailablePackageBriefing | undefined> {
  const row = await database.prepare(SELECT_BRIEFING).bind(evidenceHash).first<{ response_json: unknown }>();
  return row === null ? undefined : decodeRow(row.response_json);
}

/** Keep the first validated success for a snapshot; the insert/select batch returns that winner to every caller. */
export async function saveBriefing(
  database: D1Database,
  evidenceHash: string,
  briefing: AvailablePackageBriefing,
): Promise<AvailablePackageBriefing> {
  const validated = decodeBriefing(briefing);
  const [, selected] = await database.batch<{ response_json: unknown }>([
    database
      .prepare(
        'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?) ON CONFLICT (evidence_hash) DO NOTHING',
      )
      .bind(evidenceHash, JSON.stringify(validated)),
    database.prepare(SELECT_BRIEFING).bind(evidenceHash),
  ]);
  return decodeRow(selected?.results[0]?.response_json);
}
