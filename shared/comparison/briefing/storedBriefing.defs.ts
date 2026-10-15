import { Schema } from 'effect';

import { PackageNameSchema } from '../package/package.defs';
import { AvailablePackageBriefingSchema } from './briefing.defs';

const VersionSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const identity = { packageName: PackageNameSchema, from: VersionSchema, to: VersionSchema };

/** A read can find a durable success or a miss; infrastructure/corruption failures reject instead of becoming misses. */
export const StoredBriefingResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('missing'), ...identity }),
  Schema.Struct({ status: Schema.Literal('available'), ...identity, briefing: AvailablePackageBriefingSchema }),
]);

export type StoredBriefingResult = typeof StoredBriefingResultSchema.Type;

export const decodeStoredBriefingResult = Schema.decodeUnknownSync(StoredBriefingResultSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});
