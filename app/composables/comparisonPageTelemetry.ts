import { Effect } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

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
