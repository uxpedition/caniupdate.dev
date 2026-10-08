import { Effect } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetryComparison';
import type { TraceContext } from '#shared/traceContext.defs';

type RequestedSelectors = { readonly from: string; readonly to: string };

export const openComparisonPage = (
  telemetry: TelemetryRuntime,
  packageName: string,
  requested: RequestedSelectors,
): TraceContext => {
  const attributes = comparisonTelemetryAttributes({ packageName }, requested);
  return telemetry.runSync(
    Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      const traceContext = { traceId: span.traceId, spanId: span.spanId };
      yield* Effect.logInfo('comparison.page.opened').pipe(Effect.annotateLogs({ ...traceContext, ...attributes }));
      return traceContext;
    }).pipe(Effect.withSpan('comparison.page', { root: true, attributes })),
  );
};
