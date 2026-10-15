import { Schema } from 'effect';

import { PackageNameSchema } from '../comparison/package/package.defs';

export const TelemetryComparisonPackageSchema = PackageNameSchema;

export const TelemetryComparisonVersionSchema = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
);

export const TelemetryComparisonSelectorSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/^[0-9A-Za-z.*+^~<>=| _-]+$/),
  Schema.makeFilter((value: string) => value.trim() === value, { expected: 'a trimmed npm version selector' }),
);

export const MAX_RESOURCE_GROUPS = 4;

export const MAX_SCOPE_GROUPS = 4;

export const MAX_RECORDS = 64;

export const MAX_ATTRIBUTES = 32;

export const MAX_EVENTS = 16;

export const MAX_LINKS = 16;

export const MAX_DROPPED_COUNT = 4_294_967_295;

export const MAX_STRING_LENGTH = 262_144;

export const MAX_TOTAL_STRING_LENGTH = 262_144;

export const MAX_NODES = 50_000;

export const MAX_DEPTH = 16;

const BoundedStringSchema = Schema.String.check(Schema.isMaxLength(MAX_STRING_LENGTH));

const SmallStringSchema = Schema.String.check(Schema.isMaxLength(128));

const AttributeKeySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

const DroppedCountSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(MAX_DROPPED_COUNT),
);

const OptionalDroppedCountSchema = Schema.UndefinedOr(DroppedCountSchema);

const BoundedArray = <A, I, RD, RE>(schema: Schema.Codec<A, I, RD, RE>, maximum: number) =>
  Schema.Array(schema).check(Schema.isMaxLength(maximum));

export const HexTraceIdSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/),
  Schema.makeFilter((value: string) => value !== '00000000000000000000000000000000', {
    expected: 'a nonzero 32-character lowercase hexadecimal trace ID',
  }),
);

export const HexSpanIdSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{16}$/),
  Schema.makeFilter((value: string) => value !== '0000000000000000', {
    expected: 'a nonzero 16-character lowercase hexadecimal span ID',
  }),
);

const UnixNanoSchema = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]{0,19})$/),
  Schema.makeFilter((value: string) => BigInt(value) <= 18_446_744_073_709_551_615n, {
    expected: 'an unsigned 64-bit decimal nanosecond timestamp',
  }),
);

const RawAttributeSchema = Schema.Struct({ key: AttributeKeySchema, value: Schema.Unknown });

const ResourceSchema = Schema.Struct({
  attributes: BoundedArray(RawAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: Schema.optionalKey(OptionalDroppedCountSchema),
});

const ScopeSchema = Schema.Struct({ name: SmallStringSchema });

const LogRecordSchema = Schema.Struct({
  timeUnixNano: UnixNanoSchema,
  observedTimeUnixNano: UnixNanoSchema,
  severityNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(24)),
  severityText: Schema.Literals(['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Fatal']),
  body: Schema.Unknown,
  attributes: BoundedArray(RawAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: Schema.optionalKey(OptionalDroppedCountSchema),
  traceId: Schema.optionalKey(Schema.UndefinedOr(HexTraceIdSchema)),
  spanId: Schema.optionalKey(Schema.UndefinedOr(HexSpanIdSchema)),
});

const ScopeLogsSchema = Schema.Struct({ scope: ScopeSchema, logRecords: BoundedArray(LogRecordSchema, MAX_RECORDS) });

const ResourceLogsSchema = Schema.Struct({
  resource: ResourceSchema,
  scopeLogs: BoundedArray(ScopeLogsSchema, MAX_SCOPE_GROUPS),
});

export const OtlpLogsDataSchema = Schema.Struct({
  resourceLogs: BoundedArray(ResourceLogsSchema, MAX_RESOURCE_GROUPS),
});

const SpanEventSchema = Schema.Struct({
  name: SmallStringSchema,
  timeUnixNano: UnixNanoSchema,
  attributes: BoundedArray(RawAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: Schema.optionalKey(OptionalDroppedCountSchema),
});

const SpanLinkSchema = Schema.Struct({
  traceId: HexTraceIdSchema,
  spanId: HexSpanIdSchema,
  attributes: BoundedArray(RawAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: Schema.optionalKey(OptionalDroppedCountSchema),
});

const SpanSchema = Schema.Struct({
  traceId: HexTraceIdSchema,
  spanId: HexSpanIdSchema,
  parentSpanId: Schema.optionalKey(Schema.UndefinedOr(HexSpanIdSchema)),
  name: SmallStringSchema,
  kind: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(5)),
  startTimeUnixNano: UnixNanoSchema,
  endTimeUnixNano: UnixNanoSchema,
  attributes: BoundedArray(RawAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: Schema.optionalKey(OptionalDroppedCountSchema),
  events: BoundedArray(SpanEventSchema, MAX_EVENTS),
  droppedEventsCount: Schema.optionalKey(OptionalDroppedCountSchema),
  status: Schema.Struct({ code: Schema.Literals([0, 1, 2]) }),
  links: BoundedArray(SpanLinkSchema, MAX_LINKS),
  droppedLinksCount: Schema.optionalKey(OptionalDroppedCountSchema),
});

const ScopeSpansSchema = Schema.Struct({ scope: ScopeSchema, spans: BoundedArray(SpanSchema, MAX_RECORDS) });

const ResourceSpansSchema = Schema.Struct({
  resource: ResourceSchema,
  scopeSpans: BoundedArray(ScopeSpansSchema, MAX_SCOPE_GROUPS),
});

export const OtlpTracesDataSchema = Schema.Struct({
  resourceSpans: BoundedArray(ResourceSpansSchema, MAX_RESOURCE_GROUPS),
});

export const TelemetryServiceNameSchema = Schema.Literals([
  'can-i-update-browser',
  'can-i-update-nuxt',
  'can-i-update-briefing',
]);

export const TelemetryLogMessageSchema = Schema.Literals([
  'runtime.error',
  'runtime.warning',
  'comparison.page.opened',
  'briefing.submission.started',
  'briefing.submission.accepted',
  'Briefing submission failed',
  'briefing.generation.accepted',
  'briefing.generation.trace_context.attached',
  'briefing.generation.started',
]);

export const TelemetrySpanNameSchema = Schema.Literals([
  'Bundlephobia.getVersionBundleSize',
  'Bundlephobia.getSize',
  'Github.fetchChangelog',
  'Github.verifyPackageTag',
  'Github.fallbackChangelog',
  'Github.getPackageReleaseNotes',
  'Github.listGithubReleases',
  'Github.listGithubDirectory',
  'Github.getGithubFile',
  'Osv.getPackageVulnerabilities',
  'Osv.queryBatch',
  'Osv.getVulnerability',
  'Registry.getJson',
  'comparison.page',
  'briefing.submit',
  'briefing.generation.accepted',
  'briefing.generation.trace_context.attached',
  'briefing.generation',
]);

export const TelemetryEnvironmentSchema = Schema.Literals(['local', 'development', 'test', 'preview', 'production']);

export const TelemetryFailureReasonSchema = Schema.Literals([
  'binding-unavailable',
  'transport',
  'upstream',
  'protocol',
  'not-configured',
  'invalid-config',
  'provider-error',
  'cache-error',
  'timeout',
  'invalid-response',
]);

export const TelemetryFailureNameSchema = Schema.Literals([
  'BriefingSubmissionError',
  'PackageEvidenceClientError',
  'BriefingServiceBindingUnavailable',
  'Error',
  'TypeError',
]);

const TelemetryAttributeKeySchema = Schema.Literals([
  'exception.type',
  'exception.stacktrace',
  'error.source',
  'comparison.package.name',
  'comparison.version.from',
  'comparison.version.to',
  'comparison.requested.from',
  'comparison.requested.to',
  'service.name',
  'service.version',
  'deployment.environment.name',
  'traceId',
  'spanId',
  'parentSpanId',
  'reason',
  'name',
  'relationship',
]);

const TelemetryStringValueSchema = Schema.Struct({ stringValue: BoundedStringSchema });

const TelemetryAttributeSchema = Schema.Struct({
  key: TelemetryAttributeKeySchema,
  value: TelemetryStringValueSchema,
});

export type TelemetryAttribute = typeof TelemetryAttributeSchema.Type;

const TelemetryResourceAttributeSchema = Schema.Struct({
  key: Schema.Literals(['service.name', 'service.version', 'deployment.environment.name']),
  value: TelemetryStringValueSchema,
});

export type TelemetryResourceAttribute = typeof TelemetryResourceAttributeSchema.Type;

export const TelemetryResourceSchema = Schema.Struct({
  attributes: BoundedArray(TelemetryResourceAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: DroppedCountSchema,
});

export type TelemetryResource = typeof TelemetryResourceSchema.Type;

const SafeScopeSchema = Schema.Struct({ name: TelemetryServiceNameSchema });

const SafeLogRecordSchema = Schema.Struct({
  timeUnixNano: UnixNanoSchema,
  observedTimeUnixNano: UnixNanoSchema,
  severityNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(24)),
  severityText: Schema.Literals(['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Fatal']),
  body: Schema.Struct({ stringValue: TelemetryLogMessageSchema }),
  attributes: BoundedArray(TelemetryAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: DroppedCountSchema,
  traceId: Schema.optionalKey(HexTraceIdSchema),
  spanId: Schema.optionalKey(HexSpanIdSchema),
});

const SafeScopeLogsSchema = Schema.Struct({
  scope: SafeScopeSchema,
  logRecords: BoundedArray(SafeLogRecordSchema, MAX_RECORDS),
});

const SafeResourceLogsSchema = Schema.Struct({
  resource: TelemetryResourceSchema,
  scopeLogs: BoundedArray(SafeScopeLogsSchema, MAX_SCOPE_GROUPS),
});

export const SanitizedLogsDataSchema = Schema.Struct({
  resourceLogs: BoundedArray(SafeResourceLogsSchema, MAX_RESOURCE_GROUPS),
});

export type SanitizedLogsData = typeof SanitizedLogsDataSchema.Type;

const SafeSpanLinkSchema = Schema.Struct({
  traceId: HexTraceIdSchema,
  spanId: HexSpanIdSchema,
  attributes: BoundedArray(TelemetryAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: DroppedCountSchema,
});

const SafeSpanSchema = Schema.Struct({
  traceId: HexTraceIdSchema,
  spanId: HexSpanIdSchema,
  parentSpanId: Schema.optionalKey(HexSpanIdSchema),
  name: TelemetrySpanNameSchema,
  kind: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(5)),
  startTimeUnixNano: UnixNanoSchema,
  endTimeUnixNano: UnixNanoSchema,
  attributes: BoundedArray(TelemetryAttributeSchema, MAX_ATTRIBUTES),
  droppedAttributesCount: DroppedCountSchema,
  events: BoundedArray(Schema.Never, MAX_EVENTS),
  droppedEventsCount: DroppedCountSchema,
  status: Schema.Struct({ code: Schema.Literals([0, 1, 2]) }),
  links: BoundedArray(SafeSpanLinkSchema, MAX_LINKS),
  droppedLinksCount: DroppedCountSchema,
});

const SafeScopeSpansSchema = Schema.Struct({
  scope: SafeScopeSchema,
  spans: BoundedArray(SafeSpanSchema, MAX_RECORDS),
});

const SafeResourceSpansSchema = Schema.Struct({
  resource: TelemetryResourceSchema,
  scopeSpans: BoundedArray(SafeScopeSpansSchema, MAX_SCOPE_GROUPS),
});

export const SanitizedTraceDataSchema = Schema.Struct({
  resourceSpans: BoundedArray(SafeResourceSpansSchema, MAX_RESOURCE_GROUPS),
});

export type SanitizedTraceData = typeof SanitizedTraceDataSchema.Type;

export type SanitizedTelemetryPayload = SanitizedLogsData | SanitizedTraceData;

export type OtlpAttribute = typeof RawAttributeSchema.Type;

export type OtlpResource = typeof ResourceSchema.Type;

export type OtlpLogRecord = typeof LogRecordSchema.Type;

export type OtlpSpan = typeof SpanSchema.Type;

export type OtlpSpanLink = typeof SpanLinkSchema.Type;

export type TelemetryServiceName = typeof TelemetryServiceNameSchema.Type;

export type TelemetryLogMessage = typeof TelemetryLogMessageSchema.Type;
