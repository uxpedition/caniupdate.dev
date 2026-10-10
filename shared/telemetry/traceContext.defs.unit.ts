import { describe, expect, it } from 'vitest';

import { decodeTraceContext, formatTraceparent, parseTraceparent } from './traceContext.defs';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const SPAN_ID = '00f067aa0ba902b7';

describe('parseTraceparent', () => {
  it('parses a valid version-00 context without inheriting the remote sampling bit', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID });
  });

  it('rejects malformed, uppercase, unsupported-version, and zero identifiers', () => {
    for (const value of [
      `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`,
      `01-${TRACE_ID}-${SPAN_ID}-01`,
      `00-bf92f3577b34da6a3ce929d0e0e4736-${SPAN_ID}-01`,
      `00-${TRACE_ID}-${SPAN_ID}-gg`,
      `00-00000000000000000000000000000000-${SPAN_ID}-01`,
      `00-${TRACE_ID}-0000000000000000-01`,
      `00-${TRACE_ID}-${SPAN_ID}-0`,
      `00-${TRACE_ID}-${SPAN_ID}-01\n`,
      ` 00-${TRACE_ID}-${SPAN_ID}-01`,
    ]) {
      expect(parseTraceparent(value)).toBeUndefined();
    }
  });

  it('ignores missing or malformed persisted diagnostic context', () => {
    expect(parseTraceparent(null)).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(decodeTraceContext(undefined)).toBeUndefined();
    expect(decodeTraceContext({ traceId: TRACE_ID, spanId: '0000000000000000' })).toBeUndefined();
    expect(decodeTraceContext({ traceId: TRACE_ID, spanId: SPAN_ID, hash: 'private-job-identity' })).toBeUndefined();
  });

  it('formats the local span context as a sampled version-00 header', () => {
    expect(formatTraceparent({ traceId: TRACE_ID, spanId: SPAN_ID })).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
  });
});
