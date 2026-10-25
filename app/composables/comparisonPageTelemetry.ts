import { Effect, Tracer } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import type { ComparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryDecimal } from '#shared/telemetry/telemetryFields';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

export type ComparisonTierTelemetry = { readonly runtime: TelemetryRuntime; readonly context?: TraceContext };

/** Keep absent diagnostic context absent rather than creating an own key with an undefined value. */
export const comparisonTierTelemetry = (
  runtime: TelemetryRuntime | undefined,
  context: TraceContext | undefined,
): ComparisonTierTelemetry | undefined => {
  if (runtime === undefined) return undefined;

  return context === undefined ? { runtime } : { runtime, context };
};

type ResolvedTier = {
  readonly packageName: string;
  readonly from: string | { readonly version: string };
  readonly to: string | { readonly version: string };
};

/** Metadata and outcome classification are diagnostic-only and cannot replace a successful query value. */
const logTierSuccess = <A extends ResolvedTier>(
  result: A,
  context: TraceContext,
  operation: 'declarations' | 'measurements' | 'briefing',
  retainedData: boolean,
  started: number,
  outcome: (result: A) => 'success' | 'partial' | 'unavailable',
) => {
  const fields: ComparisonTelemetryAttributes & { outcome?: 'success' | 'partial' | 'unavailable' } =
    comparisonTelemetryAttributes(result);

  try {
    fields.outcome = outcome(result);
  } catch {
    // A classifier is diagnostic-only. Missing outcome is uncertainty, not a changed query result.
  }

  return Effect.logInfo('comparison.tier.settled').pipe(
    Effect.annotateLogs({
      ...context,
      ...fields,
      operation,
      retainedData: String(retainedData),
      durationMs: telemetryDecimal(Date.now() - started),
    }),
  );
};

/** Each query owns its settlement; retained data describes the cache at request start, not a second state store. */
export const runComparisonTier = <A extends ResolvedTier>(
  operation: 'declarations' | 'measurements' | 'briefing',
  diagnostics: ComparisonTierTelemetry | undefined,
  signal: AbortSignal,
  retainedData: boolean,
  load: (context: TraceContext | undefined) => Promise<A>,
  outcome: (result: A) => 'success' | 'partial' | 'unavailable' = () => 'success',
): Promise<A> => {
  if (diagnostics === undefined) return load(undefined);
  const started = Date.now();

  const parent =
    diagnostics.context === undefined ? undefined : Tracer.externalSpan({ ...diagnostics.context, sampled: true });

  const program = Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const context = { traceId: span.traceId, spanId: span.spanId };

    const result = yield* Effect.tryPromise({ try: () => load(context), catch: (cause) => cause }).pipe(
      Effect.tapError(() =>
        Effect.logInfo('comparison.tier.settled').pipe(
          Effect.annotateLogs({
            ...context,
            operation,
            outcome: signal.aborted ? 'cancelled' : 'failure',
            reason: signal.aborted ? 'cancelled' : 'upstream',
            retainedData: String(retainedData),
            durationMs: telemetryDecimal(Date.now() - started),
          }),
        ),
      ),
    );

    yield* logTierSuccess(result, context, operation, retainedData, started, outcome);

    return result;
  }).pipe(
    Effect.withSpan(
      operation === 'briefing' ? 'briefing.follow' : `comparison.${operation}`,
      parent === undefined ? { root: true } : { parent },
    ),
  );

  return diagnostics.runtime.runPromise(program);
};

export const openComparisonPage = (telemetry: TelemetryRuntime): TraceContext => {
  return telemetry.runSync(
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const traceContext = { traceId: span.traceId, spanId: span.spanId };
      yield* Effect.logInfo('comparison.page.opened').pipe(Effect.annotateLogs(traceContext));

      return traceContext;
    }).pipe(Effect.withSpan('comparison.page', { root: true })),
  );
};
