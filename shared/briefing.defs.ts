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

export const BRIEFING_EVIDENCE_MAX_BYTES = 48 * 1024;
const BRIEFING_EVIDENCE_MAX_SOURCES = 64;
const textEncoder = new TextEncoder();

const EvidenceIdentitySchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => value.trim() !== '', { expected: 'a nonblank evidence identity' }),
);

/** Internal packet returned by the evidence Durable Object and sent to the briefing model. */
export const BriefingEvidenceSchema = Schema.Struct({
  packageName: EvidenceIdentitySchema,
  from: EvidenceIdentitySchema,
  to: EvidenceIdentitySchema,
  sources: Schema.Array(BriefingSourceSchema),
  gaps: Schema.Array(Schema.String),
}).check(
  Schema.makeFilter(
    (evidence) =>
      evidence.sources.length <= BRIEFING_EVIDENCE_MAX_SOURCES &&
      textEncoder.encode(JSON.stringify(evidence)).byteLength <= BRIEFING_EVIDENCE_MAX_BYTES,
    { expected: 'bounded briefing evidence' },
  ),
);

export type BriefingEvidence = typeof BriefingEvidenceSchema.Type;

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
