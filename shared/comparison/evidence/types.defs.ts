import { Schema } from 'effect';

export const BundledTypeEvidenceSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(['available', 'partial']),
    matchedTargetCount: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(10_000),
    ),
  }),
  Schema.Struct({ status: Schema.Literal('unavailable'), matchedTargetCount: Schema.Null }),
]);

export type BundledTypeEvidence = typeof BundledTypeEvidenceSchema.Type;
