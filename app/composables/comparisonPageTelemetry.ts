import { Effect, Tracer } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import type { ComparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryDecimal } from '#shared/telemetry/telemetryFields';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

export type ComparisonTierTelemetry = { readonly runtime: TelemetryRuntime; readonly context?: TraceContext };

type ResolvedTier = {
  readonly packageName: string;
  readonly from: string | { readonly version: string };
  readonly to: string | { readonly version: string };
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

    // Metadata never throws, and a classifier throw drops only the outcome: diagnostics never change the query result.
    const fields: ComparisonTelemetryAttributes & { outcome?: 'success' | 'partial' | 'unavailable' } =
      comparisonTelemetryAttributes(result);

    try {
      fields.outcome = outcome(result);
    } catch {
      // A classifier is diagnostic-only. Missing outcome is uncertainty, not a changed query result.
    }

    yield* Effect.logInfo('comparison.tier.settled').pipe(
      Effect.annotateLogs({
        ...context,
        ...fields,
        operation,
        retainedData: String(retainedData),
        durationMs: telemetryDecimal(Date.now() - started),
      }),
    );

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
