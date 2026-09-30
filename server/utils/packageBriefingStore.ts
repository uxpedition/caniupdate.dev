import type { D1Database } from '@cloudflare/workers-types';
import { Data, Schema } from 'effect';

import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../../shared/briefing.defs';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const SELECT_BRIEFING = 'SELECT response_json FROM package_briefings WHERE evidence_hash = ?';

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
 * Read the snapshot stored for an evidence hash. The table is installed by `migrations/0001_package_briefings.sql`, so a
 * missing schema or binding surfaces as a rejection rather than an empty cache.
 */
export async function readStoredBriefing(
  database: D1Database,
  evidenceHash: string,
): Promise<AvailablePackageBriefing | undefined> {
  let row: { response_json: unknown } | null;
  try {
    row = await database.prepare(SELECT_BRIEFING).bind(evidenceHash).first<{ response_json: unknown }>();
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'read', cause });
  }
  return row === null ? undefined : decodeRow(row.response_json);
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
    const [, selected] = await database.batch<{ response_json: unknown }>([
      database
        .prepare(
          'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?) ON CONFLICT (evidence_hash) DO NOTHING',
        )
        .bind(evidenceHash, JSON.stringify(validated)),
      database.prepare(SELECT_BRIEFING).bind(evidenceHash),
    ]);
    responseJson = selected?.results[0]?.response_json;
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'write', cause });
  }
  return decodeRow(responseJson);
}
