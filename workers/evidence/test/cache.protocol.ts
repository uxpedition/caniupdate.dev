import { Schema } from 'effect';

const TtlMsSchema = Schema.NullOr(Schema.Finite);

export const CacheFixtureCommandSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal('initialize') }),
  Schema.Struct({
    operation: Schema.Literal('load'),
    key: Schema.String,
    value: Schema.String,
    ttlMs: TtlMsSchema,
    cacheable: Schema.Boolean,
    validation: Schema.Literals(['string', 'reject']),
    observationFailure: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({ operation: Schema.Literal('cleanup'), now: Schema.Finite }),
  Schema.Struct({
    operation: Schema.Literal('load-replacing'),
    key: Schema.String,
    value: Schema.String,
    oldValue: Schema.String,
    ttlMs: TtlMsSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('coalesce'),
    key: Schema.String,
    value: Schema.String,
    rejectSecond: Schema.Boolean,
    observationFailure: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({
    operation: Schema.Literal('serialization'),
    key: Schema.String,
    kind: Schema.Literals(['undefined', 'circular']),
  }),
]);

export type CacheFixtureCommand = typeof CacheFixtureCommandSchema.Type;

export const CacheFixtureErrorSchema = Schema.Struct({
  _tag: Schema.String,
  operation: Schema.mutableKey(Schema.optionalKey(Schema.String)),
  detail: Schema.mutableKey(Schema.optionalKey(Schema.String)),
  causeName: Schema.mutableKey(Schema.optionalKey(Schema.String)),
  causeMessage: Schema.mutableKey(Schema.optionalKey(Schema.String)),
});

export type CacheFixtureError = typeof CacheFixtureErrorSchema.Type;

// Fixed fixture-owned wire errors; emitters construct them with `.make({})`.
export const CacheFixtureRequestErrorSchema = Schema.TaggedStruct('FixtureRequestError', {});

export const CacheFixtureRouteUnavailableSchema = Schema.TaggedStruct('FixtureRouteUnavailable', {});

export const CacheFixtureOutcomeSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), error: CacheFixtureErrorSchema }),
]);

export type CacheFixtureOutcome = typeof CacheFixtureOutcomeSchema.Type;

export const CacheFixtureCoalescedSchema = Schema.Struct({
  first: CacheFixtureOutcomeSchema,
  second: CacheFixtureOutcomeSchema,
});

export type CacheFixtureCoalesced = typeof CacheFixtureCoalescedSchema.Type;

export const isCacheFixtureCoalesced = Schema.is(CacheFixtureCoalescedSchema);

export const CacheFixtureValueSchema = Schema.Union([
  Schema.String,
  Schema.Struct({ initialized: Schema.Literal(true) }),
  Schema.Struct({ cleaned: Schema.Literal(true) }),
  CacheFixtureCoalescedSchema,
]);

export type CacheFixtureValue = typeof CacheFixtureValueSchema.Type;

export const CacheFixtureResponseSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: CacheFixtureValueSchema, loaderCalls: Schema.Finite }),
  Schema.Struct({ ok: Schema.Literal(false), error: CacheFixtureErrorSchema, loaderCalls: Schema.Finite }),
]);

export type CacheFixtureResponse = typeof CacheFixtureResponseSchema.Type;
