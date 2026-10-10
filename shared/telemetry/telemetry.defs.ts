import { Result, Schema } from 'effect';

import {
  HexSpanIdSchema,
  HexTraceIdSchema,
  MAX_DEPTH,
  MAX_DROPPED_COUNT,
  MAX_NODES,
  MAX_RECORDS,
  MAX_STRING_LENGTH,
  MAX_TOTAL_STRING_LENGTH,
  OtlpLogsDataSchema,
  OtlpTracesDataSchema,
  SanitizedLogsDataSchema,
  SanitizedTraceDataSchema,
  TelemetryComparisonPackageSchema,
  TelemetryComparisonSelectorSchema,
  TelemetryComparisonVersionSchema,
  TelemetryEnvironmentSchema,
  TelemetryFailureReasonSchema,
  TelemetryFailureNameSchema,
  TelemetryLogMessageSchema,
  TelemetryResourceSchema,
  TelemetryServiceNameSchema,
  TelemetrySpanNameSchema,
} from './telemetry.schema';
import type {
  OtlpAttribute,
  OtlpLogRecord,
  OtlpResource,
  OtlpSpan,
  OtlpSpanLink,
  SanitizedLogsData,
  SanitizedTelemetryPayload,
  SanitizedTraceData,
  TelemetryAttribute,
  TelemetryResource,
  TelemetryResourceAttribute,
} from './telemetry.schema';
import { isErrorAttributeKey, sanitizeErrorAttribute } from './telemetryError';
import type { ErrorAttributeKey } from './telemetryError';

export type TelemetrySignal = 'logs' | 'traces';

export type {
  SanitizedLogsData,
  SanitizedTelemetryPayload,
  SanitizedTraceData,
  TelemetryAttribute,
  TelemetryResource,
  TelemetryServiceName,
} from './telemetry.schema';

export { TelemetryServiceNameSchema } from './telemetry.schema';

const decodeOtlpLogsData = Schema.decodeUnknownSync(OtlpLogsDataSchema, {
  errors: 'all',
  onExcessProperty: 'ignore',
});

const decodeOtlpTracesData = Schema.decodeUnknownSync(OtlpTracesDataSchema, {
  errors: 'all',
  onExcessProperty: 'ignore',
});

const decodeSanitizedLogsData = Schema.decodeUnknownSync(SanitizedLogsDataSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeSanitizedTraceData = Schema.decodeUnknownSync(SanitizedTraceDataSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeSafeLogMessage = Schema.decodeUnknownResult(Schema.Struct({ stringValue: TelemetryLogMessageSchema }), {
  errors: 'all',
  onExcessProperty: 'ignore',
});

const decodeServiceName = Schema.decodeUnknownResult(Schema.Struct({ stringValue: TelemetryServiceNameSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeServiceVersion = Schema.decodeUnknownResult(
  Schema.Struct({
    stringValue: Schema.String.check(
      Schema.isMaxLength(64),
      Schema.isPattern(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?$/),
    ),
  }),
  { errors: 'all', onExcessProperty: 'error' },
);

const decodeEnvironment = Schema.decodeUnknownResult(Schema.Struct({ stringValue: TelemetryEnvironmentSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeErrorAttributeString = Schema.decodeUnknownResult(Schema.Struct({ stringValue: Schema.String }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeTraceIdAttribute = Schema.decodeUnknownResult(Schema.Struct({ stringValue: HexTraceIdSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeSpanIdAttribute = Schema.decodeUnknownResult(Schema.Struct({ stringValue: HexSpanIdSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeFailureReason = Schema.decodeUnknownResult(Schema.Struct({ stringValue: TelemetryFailureReasonSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeFailureName = Schema.decodeUnknownResult(Schema.Struct({ stringValue: TelemetryFailureNameSchema }), {
  errors: 'all',
  onExcessProperty: 'error',
});

const decodeRelationship = Schema.decodeUnknownResult(
  Schema.Struct({ stringValue: Schema.Literal('shared-generation') }),
  { errors: 'all', onExcessProperty: 'error' },
);

const decodeComparisonPackage = Schema.decodeUnknownResult(
  Schema.Struct({ stringValue: TelemetryComparisonPackageSchema }),
  { errors: 'all', onExcessProperty: 'error' },
);

const decodeComparisonVersion = Schema.decodeUnknownResult(
  Schema.Struct({ stringValue: TelemetryComparisonVersionSchema }),
  { errors: 'all', onExcessProperty: 'error' },
);

const decodeComparisonSelector = Schema.decodeUnknownResult(
  Schema.Struct({ stringValue: TelemetryComparisonSelectorSchema }),
  { errors: 'all', onExcessProperty: 'error' },
);

const isTelemetryServiceName = Schema.is(TelemetryServiceNameSchema);

const isTelemetrySpanName = Schema.is(TelemetrySpanNameSchema);

type SafeStringValue = TelemetryAttribute['value'];

type BoundedState = { visited: number; stringLength: number };

type PendingValue = { value: unknown; depth: number };

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

type UnknownRecord = typeof UnknownRecordSchema.Type;

const isJsonString = Schema.is(Schema.String);

const isJsonNumber = Schema.is(Schema.Number);

const isJsonBoolean = Schema.is(Schema.Boolean);

const isJsonContainer = Schema.is(Schema.Union([UnknownRecordSchema, Schema.Array(Schema.Unknown)]));

const isJsonArray = Schema.is(Schema.Array(Schema.Unknown));

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

// oxlint-disable-next-line rules/no-unknown-parameters -- Bounded walker input is arbitrary JSON by contract; this is the pre-decode bound checker.
const isBoundedPrimitive = (value: unknown, state: BoundedState): boolean => {
  if (isJsonString(value)) return addStringLength(state, value);

  if (isJsonNumber(value)) return Number.isFinite(value);

  return value === null || isJsonBoolean(value);
};

const enqueueChildren = (
  // oxlint-disable-next-line rules/no-unknown-parameters -- Bounded walker input is arbitrary JSON by contract; this is the pre-decode bound checker.
  value: unknown,
  pending: Array<PendingValue>,
  depth: number,
  seen: WeakSet<object>,
  state: BoundedState,
): boolean => {
  if (!isJsonContainer(value)) return false;

  if (seen.has(value)) return false;

  seen.add(value);

  if (isJsonArray(value)) return enqueueArray(value, pending, depth);

  return enqueueRecord(value, pending, depth, state);
};

/** Bound unknown OTLP attribute values before schema decoding or transport. */
// oxlint-disable-next-line rules/no-unknown-parameters -- Bounded walker input is arbitrary JSON by contract; this is the pre-decode bound checker.
const isBoundedJson = (value: unknown): boolean => {
  const pending: Array<PendingValue> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  const state: BoundedState = { visited: 0, stringLength: 0 };

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) return false;
    state.visited++;

    if (state.visited > MAX_NODES || current.depth > MAX_DEPTH) return false;

    if (isBoundedPrimitive(current.value, state)) continue;

    if (!enqueueChildren(current.value, pending, current.depth + 1, seen, state)) return false;
  }

  return true;
};

const sanitizeKnownAttribute = (
  attribute: OtlpAttribute,
  key: TelemetryAttribute['key'],
  // oxlint-disable-next-line rules/no-unknown-parameters -- Injected decoders are library-composed envelope parsers; their input is unknown by contract.
  decode: (value: unknown) => Result.Result<SafeStringValue, unknown>,
): TelemetryAttribute | undefined => {
  const value = Result.getOrUndefined(decode(attribute.value));

  return value === undefined ? undefined : { key, value };
};

const sanitizeComparisonAttribute = (attribute: OtlpAttribute): TelemetryAttribute | undefined => {
  switch (attribute.key) {
    case 'comparison.package.name':
      return sanitizeKnownAttribute(attribute, attribute.key, decodeComparisonPackage);
    case 'comparison.version.from':
    case 'comparison.version.to':
      return sanitizeKnownAttribute(attribute, attribute.key, decodeComparisonVersion);
    case 'comparison.requested.from':
    case 'comparison.requested.to':
      return sanitizeKnownAttribute(attribute, attribute.key, decodeComparisonSelector);
    default:
      return undefined;
  }
};

const sanitizeErrorAttributeEntry = (
  attribute: OtlpAttribute,
  key: ErrorAttributeKey,
): TelemetryAttribute | undefined => {
  const raw = Result.getOrUndefined(decodeErrorAttributeString(attribute.value))?.stringValue;
  const value = raw === undefined ? undefined : sanitizeErrorAttribute(key, raw);

  return value === undefined ? undefined : { key, value: { stringValue: value } };
};

const sanitizeAttribute = (attribute: OtlpAttribute): TelemetryAttribute | undefined => {
  if (isErrorAttributeKey(attribute.key)) return sanitizeErrorAttributeEntry(attribute, attribute.key);

  switch (attribute.key) {
    case 'traceId':
      return sanitizeKnownAttribute(attribute, 'traceId', decodeTraceIdAttribute);
    case 'spanId':
    case 'parentSpanId':
      return sanitizeKnownAttribute(attribute, attribute.key, decodeSpanIdAttribute);
    case 'reason':
      return sanitizeKnownAttribute(attribute, 'reason', decodeFailureReason);
    case 'name':
      return sanitizeKnownAttribute(attribute, 'name', decodeFailureName);
    case 'relationship':
      return sanitizeKnownAttribute(attribute, 'relationship', decodeRelationship);
    default:
      return sanitizeComparisonAttribute(attribute);
  }
};

const sanitizeAttributes = (attributes: ReadonlyArray<OtlpAttribute>): ReadonlyArray<TelemetryAttribute> => {
  const sanitized: Array<TelemetryAttribute> = [];
  const seen = new Set<string>();

  for (const attribute of attributes) {
    if (seen.has(attribute.key)) continue;
    const value = sanitizeAttribute(attribute);

    if (value === undefined) continue;
    seen.add(attribute.key);
    sanitized.push(value);
  }

  return sanitized;
};

const countAfterRedaction = (original: number | undefined, inputCount: number, outputCount: number): number =>
  Math.min(MAX_DROPPED_COUNT, (original ?? 0) + inputCount - outputCount);

const sanitizeResourceAttribute = (attribute: OtlpAttribute): TelemetryResourceAttribute | undefined => {
  switch (attribute.key) {
    case 'service.name': {
      const value = Result.getOrUndefined(decodeServiceName(attribute.value));

      return value === undefined ? undefined : { key: 'service.name', value };
    }
    case 'service.version': {
      const value = Result.getOrUndefined(decodeServiceVersion(attribute.value));

      return value === undefined ? undefined : { key: 'service.version', value };
    }
    case 'deployment.environment.name': {
      const value = Result.getOrUndefined(decodeEnvironment(attribute.value));

      return value === undefined ? undefined : { key: 'deployment.environment.name', value };
    }
    default:
      return undefined;
  }
};

const sanitizeResource = (resource: OtlpResource): TelemetryResource => {
  const attributes: Array<TelemetryResourceAttribute> = [];
  const seen = new Set<string>();

  for (const attribute of resource.attributes) {
    if (seen.has(attribute.key)) continue;
    const sanitized = sanitizeResourceAttribute(attribute);

    if (sanitized === undefined) continue;
    seen.add(attribute.key);
    attributes.push(sanitized);
  }

  const resourceData = {
    attributes,
    droppedAttributesCount: countAfterRedaction(
      resource.droppedAttributesCount,
      resource.attributes.length,
      attributes.length,
    ),
  };

  return Schema.decodeUnknownSync(TelemetryResourceSchema, { errors: 'all', onExcessProperty: 'error' })(resourceData);
};

const sanitizeLogRecord = (record: OtlpLogRecord) => {
  const body = Result.getOrUndefined(decodeSafeLogMessage(record.body));

  if (body === undefined) return undefined;

  const attributes = sanitizeAttributes(record.attributes);

  return {
    timeUnixNano: record.timeUnixNano,
    observedTimeUnixNano: record.observedTimeUnixNano,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body,
    attributes,
    droppedAttributesCount: countAfterRedaction(
      record.droppedAttributesCount,
      record.attributes.length,
      attributes.length,
    ),
    ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
    ...(record.spanId === undefined ? {} : { spanId: record.spanId }),
  };
};

const sanitizeLogs = (data: typeof OtlpLogsDataSchema.Type): SanitizedLogsData => {
  let recordCount = 0;
  const resourceLogs: Array<SanitizedLogsData['resourceLogs'][number]> = [];

  for (const resourceLog of data.resourceLogs) {
    const scopeLogs: Array<SanitizedLogsData['resourceLogs'][number]['scopeLogs'][number]> = [];

    for (const scopeLog of resourceLog.scopeLogs) {
      if (!isTelemetryServiceName(scopeLog.scope.name)) continue;

      const logRecords = scopeLog.logRecords.flatMap((record) => {
        const safeRecord = sanitizeLogRecord(record);

        if (safeRecord === undefined) return [];
        recordCount++;

        return [safeRecord];
      });

      if (logRecords.length > 0) scopeLogs.push({ scope: { name: scopeLog.scope.name }, logRecords });
    }

    if (scopeLogs.length > 0) resourceLogs.push({ resource: sanitizeResource(resourceLog.resource), scopeLogs });
  }

  if (recordCount === 0) throw new TypeError('Telemetry payload has no approved log records');

  return decodeSanitizedLogsData({ resourceLogs });
};

const sanitizeSpanLink = (link: OtlpSpanLink) => {
  const attributes = sanitizeAttributes(link.attributes);

  return {
    traceId: link.traceId,
    spanId: link.spanId,
    attributes,
    droppedAttributesCount: countAfterRedaction(link.droppedAttributesCount, link.attributes.length, attributes.length),
  };
};

const sanitizeSpan = (span: OtlpSpan) => {
  if (!isTelemetrySpanName(span.name)) return undefined;
  const attributes = sanitizeAttributes(span.attributes);
  const events: Array<never> = [];

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes,
    droppedAttributesCount: countAfterRedaction(span.droppedAttributesCount, span.attributes.length, attributes.length),
    events,
    droppedEventsCount: countAfterRedaction(span.droppedEventsCount, span.events.length, events.length),
    status: { code: span.status.code },
    links: span.links.map(sanitizeSpanLink),
    droppedLinksCount: span.droppedLinksCount ?? 0,
  };
};

const sanitizeTraces = (data: typeof OtlpTracesDataSchema.Type): SanitizedTraceData => {
  let spanCount = 0;
  const resourceSpans: Array<SanitizedTraceData['resourceSpans'][number]> = [];

  for (const resourceSpan of data.resourceSpans) {
    const scopeSpans: Array<SanitizedTraceData['resourceSpans'][number]['scopeSpans'][number]> = [];

    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!isTelemetryServiceName(scopeSpan.scope.name)) continue;

      const spans = scopeSpan.spans.flatMap((span) => {
        const safeSpan = sanitizeSpan(span);

        if (safeSpan === undefined) return [];
        spanCount++;

        return [safeSpan];
      });

      if (spans.length > 0) scopeSpans.push({ scope: { name: scopeSpan.scope.name }, spans });
    }

    if (scopeSpans.length > 0) resourceSpans.push({ resource: sanitizeResource(resourceSpan.resource), scopeSpans });
  }

  if (spanCount === 0) throw new TypeError('Telemetry payload has no approved spans');

  return decodeSanitizedTraceData({ resourceSpans });
};

/** Decode and rebuild only bounded OTLP JSON records approved for application telemetry. */
// oxlint-disable rules/no-unknown-parameters -- This function is the ingress decode boundary; its body runs the bounded schema parsers above.
export function decodeTelemetryPayload(signal: 'logs', value: unknown): SanitizedLogsData;
export function decodeTelemetryPayload(signal: 'traces', value: unknown): SanitizedTraceData;
export function decodeTelemetryPayload(signal: TelemetrySignal, value: unknown): SanitizedTelemetryPayload;
export function decodeTelemetryPayload(signal: TelemetrySignal, value: unknown): SanitizedTelemetryPayload {
  if (!isBoundedJson(value)) throw new TypeError('Telemetry payload exceeds safety limits');

  switch (signal) {
    case 'logs':
      return sanitizeLogs(decodeOtlpLogsData(value));
    case 'traces':
      return sanitizeTraces(decodeOtlpTracesData(value));
    default:
      throw new TypeError('Unsupported telemetry signal');
  }
}
// oxlint-enable rules/no-unknown-parameters
