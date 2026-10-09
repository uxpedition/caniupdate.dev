import { Effect, Tracer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

import { generateBriefing } from '../../server/comparison/briefing/generation';
import type { BriefingEvidence } from '../../shared/comparison/briefing/briefing.defs';
import {
  runWithTelemetry,
  type TelemetryRuntimeOptions,
  type TelemetryWaitUntil,
} from '../../shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '../../shared/telemetry/telemetryComparison';
import { decodeTelemetryHeaders } from '../../shared/telemetry/telemetryConfig.defs';
import { decodeTraceContext } from '../../shared/telemetry/traceContext.defs';
import type { TraceContext } from '../../shared/telemetry/traceContext.defs';

export interface GenerationTraceStorage {
  put<T>(key: string, value: T): Promise<void>;
}

type TraceableRecord = { traceContext?: TraceContext; packet?: BriefingEvidence };

export type GenerationTraceEvent = 'briefing.generation.accepted' | 'briefing.generation.trace_context.attached';
export type RunningLease = { readonly fence: number; readonly generationContext?: TraceContext };

const telemetryHeadersFrom = (input?: string): Record<string, string> | undefined => {
  const decoded = decodeTelemetryHeaders(input);
  return Object.keys(decoded).length === 0 ? undefined : decoded;
};

export const briefingTelemetryOptions = (endpoint?: string, headers?: string): TelemetryRuntimeOptions => {
  const decodedHeaders = telemetryHeadersFrom(headers);
  return {
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(decodedHeaders === undefined ? {} : { headers: decodedHeaders }),
    serviceName: 'can-i-update-briefing',
  };
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
    yield* Effect.logInfo('briefing.generation.started').pipe(
      Effect.annotateLogs({
        traceId: span.traceId,
        spanId: span.spanId,
        ...(generationContext === undefined ? {} : { parentSpanId: generationContext.spanId }),
        ...identityAttributes,
      }),
      Effect.ignore,
    );
    return yield* generateBriefing(packet, config).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    );
  }).pipe(Effect.withSpan('briefing.generation', spanOptions));
};
