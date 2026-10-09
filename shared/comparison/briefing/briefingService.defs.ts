import { Schema } from 'effect';

import { decodeTraceContext } from '../../telemetry/traceContext.defs';
import type { TraceContext } from '../../telemetry/traceContext.defs';
import { decodeBriefingSubmission } from './briefingJob.defs';
import type { BriefingSubmission } from './briefingJob.defs';

export type BriefingServiceResult = {
  readonly submission: BriefingSubmission;
  readonly generationContext?: TraceContext;
};

const BriefingServiceResultEnvelopeSchema = Schema.Struct({
  submission: Schema.Unknown,
  generationContext: Schema.optionalKey(Schema.Unknown),
});
const decodeBriefingServiceResultEnvelope = Schema.decodeUnknownSync(BriefingServiceResultEnvelopeSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

/** A malformed diagnostic context is dropped; the public submission remains strictly decoded. */
export const decodeBriefingServiceResult = (value: unknown): BriefingServiceResult => {
  const envelope = decodeBriefingServiceResultEnvelope(value);
  const submission = decodeBriefingSubmission(envelope.submission);
  const generationContext = decodeTraceContext(envelope.generationContext);
  return generationContext === undefined ? { submission } : { submission, generationContext };
};
