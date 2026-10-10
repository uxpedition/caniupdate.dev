import { Schema } from 'effect';

import { MAX_DEPTH, MAX_NODES, MAX_RECORDS, MAX_STRING_LENGTH, MAX_TOTAL_STRING_LENGTH } from './telemetry.schema';

type BoundedState = { visited: number; stringLength: number };

type PendingValue = { value: unknown; depth: number };

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

type UnknownRecord = typeof UnknownRecordSchema.Type;

type BoundedTelemetryValue = null | boolean | number | string | ReadonlyArray<unknown> | UnknownRecord;

const isJsonString = Schema.is(Schema.String);

const isJsonNumber = Schema.is(Schema.Number);

const isJsonBoolean = Schema.is(Schema.Boolean);

const isJsonArray = Schema.is(Schema.Array(Schema.Unknown));

const isJsonContainer = Schema.is(Schema.Union([UnknownRecordSchema, Schema.Array(Schema.Unknown)]));

const addStringLength = (state: BoundedState, value: string): boolean => {
  state.stringLength += value.length;

  return value.length <= MAX_STRING_LENGTH && state.stringLength <= MAX_TOTAL_STRING_LENGTH;
};

const enqueueArray = (values: ReadonlyArray<unknown>, pending: Array<PendingValue>, depth: number): boolean => {
  if (values.length > MAX_RECORDS) return false;

  for (const value of values) pending.push({ value, depth });

  return true;
};

const enqueueRecord = (
  value: UnknownRecord,
  pending: Array<PendingValue>,
  depth: number,
  state: BoundedState,
): boolean => {
  const keys = Object.keys(value);

  if (keys.length > 64) return false;

  for (const key of keys) {
    if (key.length > 128 || !addStringLength(state, key)) return false;
    const child = value[key];

    if (child !== undefined) pending.push({ value: child, depth });
  }

  return true;
};

const isBoundedPrimitive = (value: unknown, state: BoundedState): value is string | number | boolean | null => {
  if (isJsonString(value)) return addStringLength(state, value);

  if (isJsonNumber(value)) return Number.isFinite(value);

  return value === null || isJsonBoolean(value);
};

const enqueueChildren = (
  value: UnknownRecord | ReadonlyArray<unknown>,
  pending: Array<PendingValue>,
  depth: number,
  seen: WeakSet<object>,
  state: BoundedState,
): boolean => {
  if (seen.has(value)) return false;
  seen.add(value);

  return isJsonArray(value) ? enqueueArray(value, pending, depth) : enqueueRecord(value, pending, depth, state);
};

const isBoundedJson = (value: unknown): value is BoundedTelemetryValue => {
  const pending: Array<PendingValue> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  const state: BoundedState = { visited: 0, stringLength: 0 };

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) return false;
    state.visited++;

    if (state.visited > MAX_NODES || current.depth > MAX_DEPTH) return false;

    if (isBoundedPrimitive(current.value, state)) continue;

    if (!isJsonContainer(current.value)) return false;

    if (!enqueueChildren(current.value, pending, current.depth + 1, seen, state)) return false;
  }

  return true;
};

const BoundedTelemetryValueSchema = Schema.declare((value: unknown): value is BoundedTelemetryValue => {
  if (!isBoundedJson(value)) throw new TypeError('Telemetry payload exceeds safety limits');

  return true;
});

/** Enforce traversal budgets before an OTLP decoder can traverse or copy the payload. */
export const decodeBoundedTelemetryValue = Schema.decodeUnknownSync(BoundedTelemetryValueSchema);
