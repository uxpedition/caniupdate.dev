import type { D1Database } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Data, Schema } from 'effect';

import {
  AvailablePackageBriefingSchema,
  type AvailablePackageBriefing,
} from '../../../shared/comparison/briefing/briefing.defs';
import { packageBriefings } from '../../../shared/db/briefingSchema';
import type {} from '../../../shared/db/d1.types';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);

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

export async function readStoredBriefing(
  database: D1Database,
  evidenceHash: string,
): Promise<AvailablePackageBriefing | undefined> {
  let row: { responseJson: string } | undefined;
  try {
    const db = drizzle(database);
    const rows = await db
      .select({ responseJson: packageBriefings.responseJson })
      .from(packageBriefings)
      .where(eq(packageBriefings.evidenceHash, evidenceHash))
      .limit(1);
    row = rows[0];
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'read', cause });
  }
  return row === undefined ? undefined : decodeRow(row.responseJson);
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
    const db = drizzle(database);
    const [, selected] = await db.batch([
      db
        .insert(packageBriefings)
        .values({ evidenceHash, responseJson: JSON.stringify(validated) })
        .onConflictDoNothing({ target: packageBriefings.evidenceHash }),
      db
        .select({ responseJson: packageBriefings.responseJson })
        .from(packageBriefings)
        .where(eq(packageBriefings.evidenceHash, evidenceHash))
        .limit(1),
    ]);
    responseJson = selected[0]?.responseJson;
  } catch (cause) {
    throw new BriefingStoreError({ operation: 'write', cause });
  }
  return decodeRow(responseJson);
}
