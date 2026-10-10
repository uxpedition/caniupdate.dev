import { Result, Schema } from 'effect';
import type { OtlpLogger, OtlpTracer } from 'effect/observability';

import type { OtlpAttribute } from './telemetry.schema';
import {
  HexSpanIdSchema,
  HexTraceIdSchema,
  MAX_DROPPED_COUNT,
  MAX_LINKS,
  MAX_RECORDS,
  MAX_RESOURCE_GROUPS,
  MAX_SCOPE_GROUPS,
  TelemetryComparisonPackageSchema,
  TelemetryComparisonSelectorSchema,
  TelemetryComparisonVersionSchema,
  TelemetryEnvironmentSchema,
  TelemetryFailureNameSchema,
  TelemetryFailureReasonSchema,
  TelemetryLogMessageSchema,
  TelemetryServiceNameSchema,
  TelemetrySpanNameSchema,
} from './telemetry.schema';
import { isErrorAttributeKey, sanitizeErrorAttribute } from './telemetryError';
import type { ErrorAttributeKey } from './telemetryError';

// Native Effect records may carry private or over-budget fields; project them before shared strict decoding.
type NativeResource = OtlpTracer.TraceData['resourceSpans'][number]['resource'];

type NativeResourceSpan = OtlpTracer.TraceData['resourceSpans'][number];

type NativeScopeSpan = NativeResourceSpan['scopeSpans'][number];

type NativeSpan = NativeScopeSpan['spans'][number];

type NativeResourceLogs = OtlpLogger.LogsData['resourceLogs'][number];

type NativeScopeLogs = NativeResourceLogs['scopeLogs'][number];

type NativeLogRecord = NonNullable<NativeScopeLogs['logRecords']>[number];

type ProjectedAttribute = { key: string; value: { stringValue: string } };

type NativeLogSeverity = {
  severityNumber: NonNullable<NativeLogRecord['severityNumber']>;
  severityText: NonNullable<NativeLogRecord['severityText']>;
};

const isHexSpanId = Schema.is(HexSpanIdSchema);

const isHexTraceId = Schema.is(HexTraceIdSchema);

const isTelemetryEnvironment = Schema.is(TelemetryEnvironmentSchema);

const isTelemetryFailureName = Schema.is(TelemetryFailureNameSchema);

const isTelemetryFailureReason = Schema.is(TelemetryFailureReasonSchema);

const isTelemetryLogMessage = Schema.is(TelemetryLogMessageSchema);

const isTelemetryServiceName = Schema.is(TelemetryServiceNameSchema);

const isTelemetrySpanName = Schema.is(TelemetrySpanNameSchema);

const isTelemetryRelationship = Schema.is(Schema.Literal('shared-generation'));

const isTelemetryServiceVersion = Schema.is(
  Schema.String.check(
    Schema.isMaxLength(64),
    Schema.isPattern(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?$/),
  ),
);

const isNativeSeverityNumber = Schema.is(
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(24)),
);

const isNativeSeverityText = Schema.is(Schema.Literals(['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Fatal']));

const ATTRIBUTE_VALUE_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = {
  'comparison.package.name': Schema.is(TelemetryComparisonPackageSchema),
  'comparison.version.from': Schema.is(TelemetryComparisonVersionSchema),
  'comparison.version.to': Schema.is(TelemetryComparisonVersionSchema),
  'comparison.requested.from': Schema.is(TelemetryComparisonSelectorSchema),
  'comparison.requested.to': Schema.is(TelemetryComparisonSelectorSchema),
  traceId: isHexTraceId,
  spanId: isHexSpanId,
  parentSpanId: isHexSpanId,
  reason: isTelemetryFailureReason,
  name: isTelemetryFailureName,
  relationship: isTelemetryRelationship,
};

const RESOURCE_VALUE_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = {
  'service.name': isTelemetryServiceName,
  'service.version': isTelemetryServiceVersion,
  'deployment.environment.name': isTelemetryEnvironment,
};

const decodeNativeValueString = Schema.decodeUnknownResult(Schema.Struct({ stringValue: Schema.String }), {
  errors: 'all',
  onExcessProperty: 'ignore',
});

const projectedDroppedCount = (original: number | undefined, inputCount: number, outputCount: number): number => {
  const initial =
    original !== undefined && Number.isInteger(original) && original >= 0 ? Math.min(original, MAX_DROPPED_COUNT) : 0;

  return Math.min(MAX_DROPPED_COUNT, initial + inputCount - outputCount);
};

const readStringValue = (value: OtlpAttribute['value']): string | undefined => {
  const envelope = Result.getOrUndefined(decodeNativeValueString(value));

  return envelope === undefined ? undefined : envelope.stringValue;
};

const validatedProjectFieldValue = (
  validate: ((value: string) => boolean) | undefined,
  seen: Set<string>,
  key: string,
  value: string | undefined,
): ProjectedAttribute | undefined => {
  if (validate === undefined || seen.has(key) || value === undefined || !validate(value)) return undefined;
  seen.add(key);

  return { key, value: { stringValue: value } };
};

const validatedErrorAttributeValue = (
  key: ErrorAttributeKey,
  raw: string | undefined,
  seen: Set<string>,
): ProjectedAttribute | undefined => {
  if (raw === undefined || seen.has(key)) return undefined;
  const value = sanitizeErrorAttribute(key, raw);

  if (value === undefined) return undefined;
  seen.add(key);

  return { key, value: { stringValue: value } };
};

const projectAttributes = (attributes: ReadonlyArray<{ readonly key: string; readonly value: unknown }>) => {
  const projected: Array<ProjectedAttribute> = [];
  const seen = new Set<string>();

  for (const attribute of attributes) {
    const projectedAttribute = isErrorAttributeKey(attribute.key)
      ? validatedErrorAttributeValue(attribute.key, readStringValue(attribute.value), seen)
      : validatedProjectFieldValue(
          Object.hasOwn(ATTRIBUTE_VALUE_VALIDATORS, attribute.key)
            ? ATTRIBUTE_VALUE_VALIDATORS[attribute.key]
            : undefined,
          seen,
          attribute.key,
          readStringValue(attribute.value),
        );

    if (projectedAttribute !== undefined) projected.push(projectedAttribute);
  }

  return projected;
};

const projectResource = (resource: NativeResource): NativeResource => {
  const attributes: NativeResource['attributes'] = [];
  const seen = new Set<string>();

  for (const attribute of resource.attributes) {
    const validate = Object.hasOwn(RESOURCE_VALUE_VALIDATORS, attribute.key)
      ? RESOURCE_VALUE_VALIDATORS[attribute.key]
      : undefined;

    if (validate === undefined || seen.has(attribute.key)) continue;
    const value = readStringValue(attribute.value);

    if (value === undefined || !validate(value)) continue;
    seen.add(attribute.key);
    attributes.push({ key: attribute.key, value: { stringValue: value } });
  }

  return {
    attributes,
    droppedAttributesCount: projectedDroppedCount(
      resource.droppedAttributesCount,
      resource.attributes.length,
      attributes.length,
    ),
  };
};

const projectSpanLinks = (sourceLinks: NativeSpan['links']): NativeSpan['links'] => {
  const links: NativeSpan['links'] = [];

  for (const link of sourceLinks) {
    if (links.length >= MAX_LINKS) break;

    if (!isHexTraceId(link.traceId) || !isHexSpanId(link.spanId)) continue;
    const attributes = projectAttributes(link.attributes);
    links.push({
      traceId: link.traceId,
      spanId: link.spanId,
      attributes,
      droppedAttributesCount: projectedDroppedCount(
        link.droppedAttributesCount,
        link.attributes.length,
        attributes.length,
      ),
    });
  }

  return links;
};

const projectSpan = (span: NativeSpan): NativeSpan | undefined => {
  if (!isTelemetrySpanName(span.name) || !isHexTraceId(span.traceId) || !isHexSpanId(span.spanId)) {
    return undefined;
  }

  const attributes = projectAttributes(span.attributes);
  const links = projectSpanLinks(span.links);

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: isHexSpanId(span.parentSpanId) ? span.parentSpanId : undefined,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes,
    droppedAttributesCount: projectedDroppedCount(
      span.droppedAttributesCount,
      span.attributes.length,
      attributes.length,
    ),
    events: [],
    droppedEventsCount: projectedDroppedCount(span.droppedEventsCount, span.events.length, 0),
    status: { code: span.status.code },
    links,
    droppedLinksCount: projectedDroppedCount(span.droppedLinksCount, span.links.length, links.length),
  };
};

const projectScopeSpans = (scopeSpan: NativeScopeSpan): NativeScopeSpan | undefined => {
  if (!isTelemetryServiceName(scopeSpan.scope.name)) return undefined;
  const spans: Array<NativeSpan> = [];

  for (let index = 0; index < scopeSpan.spans.length && index < MAX_RECORDS; index++) {
    const span = scopeSpan.spans[index];

    if (span === undefined) continue;
    const projected = projectSpan(span);

    if (projected !== undefined) spans.push(projected);
  }

  return spans.length === 0 ? undefined : { scope: { name: scopeSpan.scope.name }, spans };
};

const projectResourceSpans = (resourceSpan: NativeResourceSpan): NativeResourceSpan | undefined => {
  const scopeSpans: Array<NativeScopeSpan> = [];

  for (let index = 0; index < resourceSpan.scopeSpans.length && index < MAX_SCOPE_GROUPS; index++) {
    const scopeSpan = resourceSpan.scopeSpans[index];

    if (scopeSpan === undefined) continue;
    const projected = projectScopeSpans(scopeSpan);

    if (projected !== undefined) scopeSpans.push(projected);
  }

  return scopeSpans.length === 0 ? undefined : { resource: projectResource(resourceSpan.resource), scopeSpans };
};

export const sanitizeTelemetryTraces = (data: OtlpTracer.TraceData): OtlpTracer.TraceData => {
  const resourceSpans: Array<NativeResourceSpan> = [];

  for (let index = 0; index < data.resourceSpans.length && index < MAX_RESOURCE_GROUPS; index++) {
    const resourceSpan = data.resourceSpans[index];

    if (resourceSpan === undefined) continue;
    const projected = projectResourceSpans(resourceSpan);

    if (projected !== undefined) resourceSpans.push(projected);
  }

  return { resourceSpans };
};

const hasValidLogSeverity = (record: NativeLogRecord): record is NativeLogRecord & NativeLogSeverity =>
  record.severityNumber !== undefined &&
  isNativeSeverityNumber(record.severityNumber) &&
  record.severityText !== undefined &&
  isNativeSeverityText(record.severityText);

const projectLogRecord = (record: NativeLogRecord): NativeLogRecord | undefined => {
  const body = readStringValue(record.body);

  if (body === undefined || !isTelemetryLogMessage(body) || !hasValidLogSeverity(record)) return undefined;
  const attributes = projectAttributes(record.attributes);
  const traceId = record.traceId !== undefined && isHexTraceId(record.traceId) ? record.traceId : undefined;
  const spanId = record.spanId !== undefined && isHexSpanId(record.spanId) ? record.spanId : undefined;

  return {
    timeUnixNano: record.timeUnixNano,
    observedTimeUnixNano: record.observedTimeUnixNano,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: { stringValue: body },
    attributes,
    droppedAttributesCount: projectedDroppedCount(
      record.droppedAttributesCount,
      record.attributes.length,
      attributes.length,
    ),
    ...(traceId === undefined ? {} : { traceId }),
    ...(spanId === undefined ? {} : { spanId }),
  };
};

const projectScopeLogs = (scopeLog: NativeScopeLogs): NativeScopeLogs | undefined => {
  const scopeName = scopeLog.scope?.name;

  if (scopeName === undefined || !isTelemetryServiceName(scopeName)) return undefined;
  const sourceRecords = scopeLog.logRecords;

  if (sourceRecords === undefined) return undefined;
  const logRecords: Array<NativeLogRecord> = [];

  for (let index = 0; index < sourceRecords.length && index < MAX_RECORDS; index++) {
    const record = sourceRecords[index];

    if (record === undefined) continue;
    const projected = projectLogRecord(record);

    if (projected !== undefined) logRecords.push(projected);
  }

  return logRecords.length === 0 ? undefined : { scope: { name: scopeName }, logRecords };
};

const projectResourceLogs = (resourceLog: NativeResourceLogs): NativeResourceLogs | undefined => {
  const resource = resourceLog.resource;

  if (resource === undefined) return undefined;
  const scopeLogs: Array<NativeScopeLogs> = [];

  for (let index = 0; index < resourceLog.scopeLogs.length && index < MAX_SCOPE_GROUPS; index++) {
    const scopeLog = resourceLog.scopeLogs[index];

    if (scopeLog === undefined) continue;
    const projected = projectScopeLogs(scopeLog);

    if (projected !== undefined) scopeLogs.push(projected);
  }

  return scopeLogs.length === 0 ? undefined : { resource: projectResource(resource), scopeLogs };
};

export const sanitizeTelemetryLogs = (data: OtlpLogger.LogsData): OtlpLogger.LogsData => {
  const resourceLogs: Array<NativeResourceLogs> = [];

  for (let index = 0; index < data.resourceLogs.length && index < MAX_RESOURCE_GROUPS; index++) {
    const resourceLog = data.resourceLogs[index];

    if (resourceLog === undefined) continue;
    const projected = projectResourceLogs(resourceLog);

    if (projected !== undefined) resourceLogs.push(projected);
  }

  return { resourceLogs };
};
