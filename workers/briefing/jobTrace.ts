import { Effect, Tracer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

import { generateBriefing } from '../../server/comparison/briefing/generation';
import type { BriefingEvidence } from '../../shared/comparison/briefing/briefing.defs';
import {
  runWithTelemetry,
  type TelemetryRuntimeOptions,
  type TelemetryWaitUntil,
} from '../../shared/telemetry/telemetry';
import type { TelemetryFailureReasonSchema } from '../../shared/telemetry/telemetry.schema';
import { comparisonTelemetryAttributes } from '../../shared/telemetry/telemetryComparison';
import { decodeTelemetryHeaders } from '../../shared/telemetry/telemetryConfig.defs';
import type {
  TelemetryOperationSchema,
  TelemetryOutcomeSchema,
  TelemetrySettlementSchema,
  TelemetryTriggerSchema,
} from '../../shared/telemetry/telemetryFields';
import { decodeTraceContext } from '../../shared/telemetry/traceContext.defs';
import type { TraceContext } from '../../shared/telemetry/traceContext.defs';

export interface GenerationTraceStorage {
  put<T>(key: string, value: T): Promise<void>;
}

type TraceableRecord = { traceContext?: TraceContext; packet?: BriefingEvidence };

export type BriefingFlowEvent =
  | 'briefing.job.settled'
  | 'briefing.job.recovery'
  | 'briefing.dispatch.decision'
  | 'briefing.queue.decision';

export type BriefingSettlement = typeof TelemetrySettlementSchema.Type;

export type BriefingTrigger = typeof TelemetryTriggerSchema.Type;

export type BriefingOutcome = typeof TelemetryOutcomeSchema.Type;

/** Resolved comparison identity plus the generation root, linked rather than parented: flow records run off-span. */
export type BriefingFlowCorrelation = Partial<
  Record<
    'comparison.package.name' | 'comparison.version.from' | 'comparison.version.to' | 'linkedTraceId' | 'linkedSpanId',
    string
  >
>;

/** Every field is a fixed enum or a bounded decimal; anything else is discarded by the shared allowlist. */
export type BriefingFlowFields = BriefingFlowCorrelation & {
  readonly outcome?: BriefingOutcome;
  readonly operation?: typeof TelemetryOperationSchema.Type;
  readonly reason?: typeof TelemetryFailureReasonSchema.Type;
  readonly trigger?: BriefingTrigger;
  readonly settlement?: BriefingSettlement;
  readonly attempt?: string;
  readonly revision?: string;
};

/** Identity from the packet and the generation root from the trace context; each is absent when not resolvable. */
export const flowCorrelation = (record: TraceableRecord | undefined): BriefingFlowCorrelation => {
  if (record === undefined) return {};

  const identity = record.packet === undefined ? {} : comparisonTelemetryAttributes(record.packet);
  const generation = decodeTraceContext(record.traceContext);

  return generation === undefined
    ? identity
    : { ...identity, linkedTraceId: generation.traceId, linkedSpanId: generation.spanId };
};

/**
 * Best-effort diagnostic record. It is never awaited, so the job lock and the Queue ack do not wait on the exporter,
 * and a sink or runtime failure is swallowed. `waitUntil` keeps the flush alive past the response when available.
 */
export const emitBriefingFlowEvent = (
  event: BriefingFlowEvent,
  fields: BriefingFlowFields,
  options: TelemetryRuntimeOptions,
  waitUntil?: TelemetryWaitUntil,
): void => {
  // Every synchronous failure here (effect construction, runtime setup, or the lifecycle hook) stays inside this
  // function: the caller's ack, lock, and terminal ordering must not depend on a diagnostic.
  try {
    const emission = runWithTelemetry(Effect.logInfo(event).pipe(Effect.annotateLogs(fields)), options, waitUntil).then(
      () => undefined,
      () => undefined,
    );

    waitUntil?.(emission);
  } catch {
    // Dropped: a failed diagnostic is not a failed job.
  }
};

type WritableTelemetryOptions = { -readonly [K in keyof TelemetryRuntimeOptions]: TelemetryRuntimeOptions[K] };

type GenerationLogAnnotations = { traceId: string; spanId: string; parentSpanId?: string };

export type GenerationTraceEvent = 'briefing.generation.accepted' | 'briefing.generation.trace_context.attached';

export type RunningLease = { readonly fence: number; readonly generationContext?: TraceContext };

const telemetryHeadersFrom = (input?: string): Record<string, string> | undefined => {
  const decoded = decodeTelemetryHeaders(input);

  return Object.keys(decoded).length === 0 ? undefined : decoded;
};

export const briefingTelemetryOptions = (endpoint?: string, headers?: string): TelemetryRuntimeOptions => {
  const decodedHeaders = telemetryHeadersFrom(headers);

  const options: WritableTelemetryOptions = { serviceName: 'can-i-update-briefing' };

  if (endpoint !== undefined) options.endpoint = endpoint;

  if (decodedHeaders !== undefined) options.headers = decodedHeaders;

  return options;
};

/** Called under the Durable Object lock so submitters and a Queue run adopt one persisted root context. */
export const ensureGenerationTraceContext = async <T extends TraceableRecord>(
  storage: GenerationTraceStorage,
  key: string,
  record: T,
  event: GenerationTraceEvent,
  options: TelemetryRuntimeOptions = briefingTelemetryOptions(),
  waitUntil?: TelemetryWaitUntil,
): Promise<{
  readonly record: Omit<T, 'traceContext'> & { traceContext?: TraceContext };
  readonly generationContext?: TraceContext;
}> => {
  const existing = decodeTraceContext(record.traceContext);

  if (existing !== undefined) return { record, generationContext: existing };

  const withoutTraceContext = { ...record };
  delete withoutTraceContext.traceContext;
  const identityAttributes = record.packet === undefined ? {} : comparisonTelemetryAttributes(record.packet);

  const eventProgram = Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const generationContext = decodeTraceContext({ traceId: span.traceId, spanId: span.spanId });

    if (generationContext === undefined) {
      if (event === 'briefing.generation.accepted') {
        yield* Effect.tryPromise({ try: () => storage.put(key, withoutTraceContext), catch: (cause) => cause });
      }

      return { record: withoutTraceContext };
    }

    const tracedRecord = { ...withoutTraceContext, traceContext: generationContext };
    yield* Effect.tryPromise({ try: () => storage.put(key, tracedRecord), catch: (cause) => cause });
    yield* Effect.logInfo(event).pipe(
      Effect.annotateLogs({ ...generationContext, ...identityAttributes }),
      Effect.ignore,
    );

    return { record: tracedRecord, generationContext };
  }).pipe(Effect.withSpan(event, { root: true, attributes: identityAttributes }));

  try {
    return await runWithTelemetry(eventProgram, options, waitUntil);
  } catch {
    // A trace-context write is optional, but the new job record itself is mandatory and must still fail normally.
    if (event === 'briefing.generation.accepted') await storage.put(key, withoutTraceContext);

    return { record: withoutTraceContext };
  }
};

/** Run one provider call as a child of the durable root without keeping a span alive across Queue delivery. */
export const runTracedGeneration = (
  packet: BriefingEvidence,
  config: Parameters<typeof generateBriefing>[1],
  generationContext?: TraceContext,
) => {
  const generationParent =
    generationContext === undefined ? undefined : Tracer.externalSpan({ ...generationContext, sampled: true });

  const identityAttributes = comparisonTelemetryAttributes(packet);

  const spanOptions = {
    ...(generationParent === undefined ? { root: true } : { parent: generationParent }),
    attributes: identityAttributes,
  };

  return Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const annotations: GenerationLogAnnotations = { traceId: span.traceId, spanId: span.spanId };

    if (generationContext !== undefined) annotations.parentSpanId = generationContext.spanId;

    yield* Effect.logInfo('briefing.generation.started').pipe(
      Effect.annotateLogs({ ...annotations, ...identityAttributes }),
      Effect.ignore,
    );

    return yield* generateBriefing(packet, config).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    );
  }).pipe(Effect.withSpan('briefing.generation', spanOptions));
};
