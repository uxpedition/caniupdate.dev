import redact from '@pinojs/redact';
import { Context, Predicate, References, Schema } from 'effect';

import {
  HexSpanIdSchema,
  HexTraceIdSchema,
  TelemetryComparisonPackageSchema,
  TelemetryComparisonVersionSchema,
  TelemetryFailureNameSchema,
  TelemetryFailureReasonSchema,
} from './telemetry.schema';
import { isErrorAttributeKey, sanitizeErrorAttribute } from './telemetryError';
import type { ErrorAttributeKey } from './telemetryError';

export const TelemetryOutcomeSchema = Schema.Literals([
  'success',
  'partial',
  'failure',
  'cancelled',
  'available',
  'unavailable',
  'queued',
  'running',
  'joined',
  'hit',
  'miss',
  'coalesced',
  'sent',
  'retry',
  'ack',
  'ignored',
  'exhausted',
]);

export const TelemetryOperationSchema = Schema.Literals([
  'declarations',
  'measurements',
  'briefing',
  'request',
  'collection',
  'archive',
  'initialize',
  'read',
  'write',
  'delete',
  'serialize',
  'decode',
  'dispatch',
  'queue',
  'generation',
  'reconcile',
  'subscription',
  'search',
  'metadata',
  'navigation',
]);

export const TelemetryProviderSchema = Schema.Literals(['registry', 'osv', 'bundle', 'tarball', 'release-notes']);

export const TelemetryTriggerSchema = Schema.Literals(['submission', 'alarm', 'queue', 'execution', 'recovery']);

export const TelemetrySettlementSchema = Schema.Literals([
  'generation',
  'persisted-result',
  'lease-expired',
  'not-configured',
  'invalid-config',
  'storage-failure',
  'dispatch-exhausted',
  'provider-failure',
]);

export const TelemetryCountBucketSchema = Schema.Literals(['0', '1', '2-10', '11-50', '51+']);

export const TelemetryDecimalSchema = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]{0,9})$/));

const validators = {
  'comparison.package.name': Schema.is(TelemetryComparisonPackageSchema),
  'comparison.version.from': Schema.is(TelemetryComparisonVersionSchema),
  'comparison.version.to': Schema.is(TelemetryComparisonVersionSchema),
  traceId: Schema.is(HexTraceIdSchema),
  spanId: Schema.is(HexSpanIdSchema),
  parentSpanId: Schema.is(HexSpanIdSchema),
  linkedTraceId: Schema.is(HexTraceIdSchema),
  linkedSpanId: Schema.is(HexSpanIdSchema),
  reason: Schema.is(TelemetryFailureReasonSchema),
  name: Schema.is(TelemetryFailureNameSchema),
  relationship: Schema.is(Schema.Literals(['shared-generation', 'shared-collection'])),
  outcome: Schema.is(TelemetryOutcomeSchema),
  operation: Schema.is(TelemetryOperationSchema),
  provider: Schema.is(TelemetryProviderSchema),
  trigger: Schema.is(TelemetryTriggerSchema),
  settlement: Schema.is(TelemetrySettlementSchema),
  durationMs: Schema.is(TelemetryDecimalSchema),
  attempt: Schema.is(TelemetryDecimalSchema),
  revision: Schema.is(TelemetryDecimalSchema),
  statusClass: Schema.is(Schema.Literals(['2xx', '3xx', '4xx', '5xx'])),
  retainedData: Schema.is(Schema.Literals(['true', 'false'])),
  resultCount: Schema.is(TelemetryCountBucketSchema),
};

const isApplicationKey = (key: string): key is keyof typeof validators => Object.hasOwn(validators, key);

/** The same allowlist gates console, native OTLP and bounded public ingress. No free-text scanning. */
export const sanitizeApplicationField = <Value>(key: string, value: Value): string | undefined => {
  if (!Predicate.isString(value)) return undefined;

  if (isErrorAttributeKey(key)) return sanitizeErrorAttribute(key, value);

  return isApplicationKey(key) && validators[key](value) ? value : undefined;
};

// Remove whole sensitive fields; nested objects stay opaque and are excluded by the scalar allowlist.
// Wildcard paths would clone unknown payloads and inspect their getters before projection.
const removeSensitiveFields = redact({
  paths: [
    'headers',
    'cookies',
    'authorization',
    'credentials',
    'request',
    'response',
    'evidence',
    'providerPayload',
    'cause',
    '["exception.message"]',
  ],
  remove: true,
  serialize: false,
});

export const sanitizeApplicationAnnotations = (
  input: Context.Service.Shape<typeof References.CurrentLogAnnotations>,
) => {
  const stripped = removeSensitiveFields(input);
  const output: Partial<Record<keyof typeof validators | ErrorAttributeKey, string>> = {};

  if (Predicate.isString(stripped)) return output;

  for (const [key, raw] of Object.entries(stripped)) {
    const value = sanitizeApplicationField(key, raw);

    if (value !== undefined && (isApplicationKey(key) || isErrorAttributeKey(key))) output[key] = value;
  }

  return output;
};

/** Timings/counters use bounded decimal strings in every representation. */
export const telemetryDecimal = (value: number): string =>
  String(Math.min(9_999_999_999, Math.max(0, Math.round(Number.isFinite(value) ? value : 0))));
