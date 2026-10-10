import { Effect, Option, Schema } from 'effect';

import { TraceContextSchema } from '../../telemetry/traceContext.defs';
import type { TraceContext } from '../../telemetry/traceContext.defs';
import { BriefingSubmissionSchema } from './briefingJob.defs';
import type { BriefingSubmission } from './briefingJob.defs';

export type BriefingServiceResult = {
  readonly submission: BriefingSubmission;
  readonly generationContext?: TraceContext;
};

// A malformed diagnostic context is dropped; the public submission remains strictly decoded. Any failure for the
// context property (wrong shape, undeclared keys, or an undefined value) becomes an absent key.
const GenerationContextSchema = Schema.optionalKey(
  TraceContextSchema.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
);

const BriefingServiceResultSchema: Schema.Codec<BriefingServiceResult> = Schema.Struct({
  submission: BriefingSubmissionSchema,
  generationContext: GenerationContextSchema,
});

// The envelope rejects undeclared keys at every level, so a smuggled field is a submission failure, not dropped data.
export const decodeBriefingServiceResult = Schema.decodeUnknownSync(BriefingServiceResultSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});
