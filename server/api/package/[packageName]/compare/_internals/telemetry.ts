import { Effect, Tracer } from 'effect';
import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';

import { runWithTelemetry } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryWaitUntil } from '#shared/telemetry/telemetryContext';
import { telemetryDecimal } from '#shared/telemetry/telemetryFields';
import { parseTraceparent } from '#shared/telemetry/traceContext.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

import { readServerTelemetryConfig } from '../../../../../telemetry/runtimeConfig';
import { PackageEvidenceClientError } from './evidenceClient';
import type { PackageEvidenceRequest } from './evidenceClient';
import { readComparisonRequest } from './request';

type ResolvedComparison = {
  readonly packageName: string;
  readonly from: { readonly version: string };
  readonly to: { readonly version: string };
};

/** A successful fetch is not completion until the owning client has decoded and matched its response. */
export const tracedEvidenceRequest = <A>(
  operation: 'measurements' | 'briefing',
  load: (context: TraceContext) => Promise<A>,
) =>
  Effect.gen(function* () {
    const started = Date.now();
    const span = yield* Effect.currentSpan;
    const context = { traceId: span.traceId, spanId: span.spanId };

    const result = yield* Effect.tryPromise({ try: () => load(context), catch: (cause) => cause }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning('evidence.request.completed').pipe(
          Effect.annotateLogs({
            ...context,
            operation,
            outcome: 'failure',
            reason: cause instanceof PackageEvidenceClientError ? cause.reason : 'transport',
            statusClass:
              cause instanceof PackageEvidenceClientError && cause.statusCode !== undefined
                ? `${Math.floor(cause.statusCode / 100)}xx`
                : '5xx',
            durationMs: telemetryDecimal(Date.now() - started),
          }),
        ),
      ),
    );

    yield* Effect.logInfo('evidence.request.completed').pipe(
      Effect.annotateLogs({
        ...context,
        operation,
        outcome: 'success',
        statusClass: '2xx',
        durationMs: telemetryDecimal(Date.now() - started),
      }),
    );

    return result;
  }).pipe(Effect.withSpan('evidence.request', { kind: 'client' }));

type ComparisonOperation = 'declarations' | 'measurements';

type ComparisonRequestLoad<A extends ResolvedComparison, E> = (
  request: PackageEvidenceRequest,
  context: TraceContext,
) => Effect.Effect<A, E>;

const logComparisonRequestFailure = (operation: ComparisonOperation, validated: boolean, started: number) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    yield* Effect.logWarning(validated ? 'comparison.request.completed' : 'comparison.request.rejected').pipe(
      Effect.annotateLogs({
        traceId: span.traceId,
        spanId: span.spanId,
        operation,
        outcome: 'failure',
        reason: validated ? 'upstream' : 'invalid-input',
        statusClass: validated ? '5xx' : '4xx',
        durationMs: telemetryDecimal(Date.now() - started),
      }),
    );
  });

const comparisonRequestProgram = <A extends ResolvedComparison, E>(
  event: H3Event,
  operation: ComparisonOperation,
  load: ComparisonRequestLoad<A, E>,
  started: number,
) => {
  let validated = false;

  return Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const context = { traceId: span.traceId, spanId: span.spanId };

    const request = yield* Effect.tryPromise({
      try: () => readComparisonRequest(event),
      catch: (cause) => cause,
    });

    validated = true;
    const result = yield* load(request, context);
    const identity = comparisonTelemetryAttributes(result);
    yield* Effect.annotateCurrentSpan(identity);
    yield* Effect.logInfo('comparison.request.completed').pipe(
      Effect.annotateLogs({
        ...context,
        ...identity,
        operation,
        outcome: 'success',
        statusClass: '2xx',
        durationMs: telemetryDecimal(Date.now() - started),
      }),
    );

    return result;
  }).pipe(Effect.tapError(() => logComparisonRequestFailure(operation, validated, started)));
};

/** One public operation owns rejection/completion; input identity is attached only after registry resolution. */
export const runComparisonRequest = <A extends ResolvedComparison, E>(
  event: H3Event,
  operation: ComparisonOperation,
  load: ComparisonRequestLoad<A, E>,
): Promise<A> => {
  const incoming = parseTraceparent(getRequestHeader(event, 'traceparent'));
  const parent = incoming === undefined ? undefined : Tracer.externalSpan({ ...incoming, sampled: true });

  const program = comparisonRequestProgram(event, operation, load, Date.now()).pipe(
    Effect.withSpan(
      `comparison.${operation}`,
      parent === undefined ? { root: true, kind: 'server' } : { parent, kind: 'server' },
    ),
  );

  const telemetry = readServerTelemetryConfig(event);

  return runWithTelemetry(
    program,
    telemetry.enabled
      ? { serviceName: 'can-i-update-nuxt', endpoint: telemetry.endpoint, headers: telemetry.headers }
      : { serviceName: 'can-i-update-nuxt' },
    telemetryWaitUntil(event.context),
  );
};
