import { describe, expect, it } from 'vitest';

import type { BriefingSubmission } from './briefingJob.defs';
import { decodeBriefingServiceResult } from './briefingService.defs';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';
const TRACE_CONTEXT = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' };
const submission: BriefingSubmission = {
  status: 'queued',
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  hash: HASH,
  eventsUrl: `wss://briefing.example/api/briefings/${HASH}/events`,
  revision: 3,
};

describe('decodeBriefingServiceResult', () => {
  it('decodes the private generation context alongside the unchanged submission', () => {
    expect(decodeBriefingServiceResult({ submission, generationContext: TRACE_CONTEXT })).toEqual({
      submission,
      generationContext: TRACE_CONTEXT,
    });
  });

  it('drops malformed diagnostic context without accepting malformed submissions or outer fields', () => {
    expect(
      decodeBriefingServiceResult({ submission, generationContext: { ...TRACE_CONTEXT, spanId: '0000000000000000' } }),
    ).toEqual({
      submission,
    });
    expect(decodeBriefingServiceResult({ submission, generationContext: { ...TRACE_CONTEXT, hash: HASH } })).toEqual({
      submission,
    });
    expect(() => decodeBriefingServiceResult({ submission: { ...submission, privateField: 'not public' } })).toThrow();
    expect(() =>
      decodeBriefingServiceResult({ submission, generationContext: TRACE_CONTEXT, privateField: HASH }),
    ).toThrow();
  });
});
