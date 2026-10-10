import { flow, Result, Schema } from 'effect';

import {
  HexSpanIdSchema,
  HexTraceIdSchema,
  MAX_DROPPED_COUNT,
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
  SanitizedTraceData,
  TelemetryAttribute,
  TelemetryResource,
  TelemetryResourceAttribute,
} from './telemetry.schema';
import { decodeBoundedTelemetryValue } from './telemetryBounds';
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

/** Decodes one raw OTLP attribute value into a sanitized value; library decoders match this shape. */
type DecodeAttributeValue = (value: OtlpAttribute['value']) => Result.Result<SafeStringValue, Schema.SchemaError>;

const sanitizeKnownAttribute = (
  attribute: OtlpAttribute,
  key: TelemetryAttribute['key'],
  decode: DecodeAttributeValue,
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
