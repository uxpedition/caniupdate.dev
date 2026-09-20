import { Schema } from 'effect';

import type { ComparisonVersion, PackageComparison } from './comparison.defs';
import type { PackageReleaseNotes } from './github.defs';

export type BriefingInput = {
  packageName: string;
  from: ComparisonVersion;
  to: ComparisonVersion;
  comparison: PackageComparison;
  releaseNotes: PackageReleaseNotes;
};

export const BriefingSourceSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['fact', 'maintainer', 'coverage']),
  label: Schema.String,
  urls: Schema.Array(Schema.String),
  text: Schema.String,
});

export type BriefingSource = typeof BriefingSourceSchema.Type;

export type BriefingEvidence = {
  packageName: string;
  from: string;
  to: string;
  sources: readonly BriefingSource[];
  gaps: readonly string[];
};

export const BriefingBulletSchema = Schema.Struct({
  kind: Schema.Literals(['change', 'migration', 'coverage']),
  basis: Schema.Literals(['fact', 'maintainer', 'inference']),
  text: Schema.String,
  evidenceIds: Schema.Array(Schema.String),
});

export type BriefingBullet = typeof BriefingBulletSchema.Type;

export const AvailablePackageBriefingSchema = Schema.Struct({
  status: Schema.Literal('available'),
  model: Schema.String,
  bullets: Schema.Array(BriefingBulletSchema),
  sources: Schema.Array(BriefingSourceSchema),
});

export type AvailablePackageBriefing = typeof AvailablePackageBriefingSchema.Type;

export type BriefingUnavailableReason =
  | 'not-configured'
  | 'invalid-config'
  | 'provider-error'
  | 'cache-error'
  | 'timeout'
  | 'invalid-response';

export type PackageBriefing =
  | AvailablePackageBriefing
  | { status: 'unavailable'; reason: BriefingUnavailableReason; bullets: readonly []; sources: readonly [] };
