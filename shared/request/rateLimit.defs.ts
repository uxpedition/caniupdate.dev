import { Option, Schema } from 'effect';

/** Private, transient admission identity. Never include it in evidence, durable jobs, or diagnostics. */
export const RateLimitCallerSchema = Schema.Struct({
  key: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});

export type RateLimitCaller = typeof RateLimitCallerSchema.Type;

export const decodeRateLimitCaller = Schema.decodeUnknownSync(RateLimitCallerSchema, {
  onExcessProperty: 'error',
});

export const RateLimitResponseSchema = Schema.Struct({
  code: Schema.Literals(['request-rate-limited', 'generation-rate-limited']),
  retryAfter: Schema.Literal(60),
});

export type RateLimitResponse = typeof RateLimitResponseSchema.Type;

const ErrorResponseSchema = Schema.Struct({
  statusCode: Schema.Literal(429),
  data: RateLimitResponseSchema,
});

const decodeErrorResponse = Schema.decodeUnknownOption(ErrorResponseSchema);

const decodeFetchError = Schema.decodeUnknownOption(Schema.Struct({ data: ErrorResponseSchema }));

export const rateLimitMessage = (cause: unknown): string | undefined => {
  // ofetch retains the sanitized H3 response body under `data`.
  const envelope = Option.getOrUndefined(decodeFetchError(cause));
  const direct = envelope?.data ?? Option.getOrUndefined(decodeErrorResponse(cause));

  if (direct === undefined) return undefined;

  return direct.data.code === 'generation-rate-limited'
    ? 'Too many new AI briefings from this network. Wait about a minute, then retry. Package facts remain available.'
    : 'Too many requests from this network. Wait about a minute, then retry.';
};
