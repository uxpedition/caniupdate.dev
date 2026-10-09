import { Schema } from 'effect';

export type TraceContext = { readonly traceId: string; readonly spanId: string };

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';
const TRACEPARENT_LENGTH = 55;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export const TraceContextSchema: Schema.Codec<TraceContext> = Schema.Struct({
  traceId: Schema.String.check(
    Schema.makeFilter((value: string) => value.length === 32 && /^[0-9a-f]{32}$/.test(value), {
      expected: '32 lowercase hexadecimal characters',
    }),
    Schema.makeFilter((value: string) => value !== ZERO_TRACE_ID, { expected: 'a nonzero trace ID' }),
  ),
  spanId: Schema.String.check(
    Schema.makeFilter((value: string) => value.length === 16 && /^[0-9a-f]{16}$/.test(value), {
      expected: '16 lowercase hexadecimal characters',
    }),
    Schema.makeFilter((value: string) => value !== ZERO_SPAN_ID, { expected: 'a nonzero span ID' }),
  ),
});

const decodeTraceContextSync = Schema.decodeUnknownSync(TraceContextSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

/** Invalid or undeclared persisted diagnostics are absent, never submission failures. */
export const decodeTraceContext = (value: unknown): TraceContext | undefined => {
  try {
    return decodeTraceContextSync(value);
  } catch {
    return undefined;
  }
};

/** Parse only the W3C version-00 shape. Incoming sampling flags do not control local console logging. */
export const parseTraceparent = (value: string | null | undefined): TraceContext | undefined => {
  if (value === null || value === undefined || value.length !== TRACEPARENT_LENGTH) return undefined;
  const match = TRACEPARENT.exec(value);
  const traceId = match?.[1];
  const spanId = match?.[2];
  if (traceId === undefined || spanId === undefined) return undefined;
  return decodeTraceContext({ traceId, spanId });
};

/** Emit the local sampled flag regardless of the inbound parent flags. */
export const formatTraceparent = ({ traceId, spanId }: TraceContext): string => `00-${traceId}-${spanId}-01`;
