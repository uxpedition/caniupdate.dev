import { flow, Result, Schema } from 'effect';

import {
  MAX_DROPPED_COUNT,
  OtlpLogsDataSchema,
  OtlpTracesDataSchema,
  SanitizedLogsDataSchema,
  SanitizedTraceDataSchema,
  TelemetryAttributeKeySchema,
  TelemetryEnvironmentSchema,
  TelemetryInstrumentationNameSchema,
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
  SanitizedTraceData,
  TelemetryAttribute,
  TelemetryResource,
  TelemetryResourceAttribute,
} from './telemetry.schema';
import { decodeBoundedTelemetryValue } from './telemetryBounds';
import { sanitizeApplicationField } from './telemetryFields';

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

const isTelemetryInstrumentationName = Schema.is(TelemetryInstrumentationNameSchema);

const isTelemetrySpanName = Schema.is(TelemetrySpanNameSchema);

type SanitizedLogRecord = SanitizedLogsData['resourceLogs'][number]['scopeLogs'][number]['logRecords'][number];

type MutableSanitizedLogRecord = { -readonly [Key in keyof SanitizedLogRecord]: SanitizedLogRecord[Key] };

type SanitizedSpan = SanitizedTraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number];

type MutableSanitizedSpan = { -readonly [Key in keyof SanitizedSpan]: SanitizedSpan[Key] };

const isApplicationAttributeKey = Schema.is(TelemetryAttributeKeySchema);

const sanitizeAttribute = (attribute: OtlpAttribute): TelemetryAttribute | undefined => {
  if (!isApplicationAttributeKey(attribute.key)) return undefined;
  const raw = Result.getOrUndefined(decodeErrorAttributeString(attribute.value))?.stringValue;
  const value = sanitizeApplicationField(attribute.key, raw);

  return value === undefined ? undefined : { key: attribute.key, value: { stringValue: value } };
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

const sanitizeLogRecord = (record: OtlpLogRecord): MutableSanitizedLogRecord | undefined => {
  const body = Result.getOrUndefined(decodeSafeLogMessage(record.body));

  if (body === undefined) return undefined;

  const attributes = sanitizeAttributes(record.attributes);

  const safeRecord: MutableSanitizedLogRecord = {
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
  };

  // Absent IDs stay absent (not undefined): Schema.optionalKey rejects an explicit undefined value.
  if (record.traceId !== undefined) safeRecord.traceId = record.traceId;

  if (record.spanId !== undefined) safeRecord.spanId = record.spanId;

  return safeRecord;
};

const sanitizeLogs = (data: typeof OtlpLogsDataSchema.Type): SanitizedLogsData => {
  let recordCount = 0;
  const resourceLogs: Array<SanitizedLogsData['resourceLogs'][number]> = [];

  for (const resourceLog of data.resourceLogs) {
    const scopeLogs: Array<SanitizedLogsData['resourceLogs'][number]['scopeLogs'][number]> = [];

    for (const scopeLog of resourceLog.scopeLogs) {
      if (!isTelemetryInstrumentationName(scopeLog.scope.name)) continue;

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

const sanitizeSpan = (span: OtlpSpan): MutableSanitizedSpan | undefined => {
  if (!isTelemetrySpanName(span.name)) return undefined;
  const attributes = sanitizeAttributes(span.attributes);
  const events: Array<never> = [];

  const safeSpan: MutableSanitizedSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
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

  // Root spans carry no parent; the key must stay absent so the strict sanitized-span schema accepts it.
  if (span.parentSpanId !== undefined) safeSpan.parentSpanId = span.parentSpanId;

  return safeSpan;
};

const sanitizeTraces = (data: typeof OtlpTracesDataSchema.Type): SanitizedTraceData => {
  let spanCount = 0;
  const resourceSpans: Array<SanitizedTraceData['resourceSpans'][number]> = [];

  for (const resourceSpan of data.resourceSpans) {
    const scopeSpans: Array<SanitizedTraceData['resourceSpans'][number]['scopeSpans'][number]> = [];

    for (const scopeSpan of resourceSpan.scopeSpans) {
      if (!isTelemetryInstrumentationName(scopeSpan.scope.name)) continue;

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

const decodeTelemetryLogs = flow(decodeBoundedTelemetryValue, decodeOtlpLogsData, sanitizeLogs);

const decodeTelemetryTraces = flow(decodeBoundedTelemetryValue, decodeOtlpTracesData, sanitizeTraces);

/** Select the ingress decoder; bounds are checked before OTLP decoding and sanitization. */
export function decodeTelemetryPayload(signal: 'logs'): typeof decodeTelemetryLogs;
export function decodeTelemetryPayload(signal: 'traces'): typeof decodeTelemetryTraces;
export function decodeTelemetryPayload(
  signal: TelemetrySignal,
): typeof decodeTelemetryLogs | typeof decodeTelemetryTraces;
export function decodeTelemetryPayload(
  signal: TelemetrySignal,
): typeof decodeTelemetryLogs | typeof decodeTelemetryTraces {
  switch (signal) {
    case 'logs':
      return decodeTelemetryLogs;
    case 'traces':
      return decodeTelemetryTraces;
    default:
      throw new TypeError('Unsupported telemetry signal');
  }
}
