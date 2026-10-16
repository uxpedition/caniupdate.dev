import { Effect, Predicate, Schema } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { TelemetryCountBucketSchema, telemetryDecimal } from '#shared/telemetry/telemetryFields';

/** Successful package completions are sampled at this rate. Failures are never sampled. */
export const PACKAGE_REQUEST_SUCCESS_SAMPLE_RATE = 0.1;

export const PACKAGE_SEARCH_FLOW = { event: 'package.search.completed', operation: 'search' } as const;

export const PACKAGE_METADATA_FLOW = { event: 'package.metadata.completed', operation: 'metadata' } as const;

export type PackageRequestFlow = typeof PACKAGE_SEARCH_FLOW | typeof PACKAGE_METADATA_FLOW;

export type ComparisonNavigationOutcome =
  | { readonly outcome: 'success' | 'ignored' }
  | { readonly outcome: 'cancelled'; readonly reason: 'cancelled' }
  | { readonly outcome: 'failure'; readonly reason: 'invalid-input' | 'navigation' };

const HttpErrorStatus = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 400, maximum: 599 }));

const isHttpErrorStatus = Schema.is(HttpErrorStatus);

/**
 * Runs diagnostic work and swallows any failure in it. Application results, errors, and abort semantics never depend on
 * telemetry, so every read of an error's getters, the sampler, the clock, and the runtime happens inside this guard.
 */
const diagnose = (record: () => void): void => {
  try {
    record();
  } catch {
    // Diagnostics are best-effort.
  }
};

/** Reads the clock without ever throwing; a missing reading omits `durationMs` instead of guessing one. */
const readClock = (): number | undefined => {
  try {
    return performance.now();
  } catch {
    return undefined;
  }
};

type CountBucket = typeof TelemetryCountBucketSchema.Type;

const countBucket = (count: number): CountBucket => {
  if (count === 0) return '0';

  if (count === 1) return '1';

  if (count <= 10) return '2-10';

  if (count <= 50) return '11-50';

  return '51+';
};

type PackageRequestFailureClassification = {
  readonly reason: 'invalid-input' | 'upstream' | 'transport';
  readonly statusClass?: '4xx' | '5xx';
};

type PackageRequestAnnotations = {
  readonly operation: PackageRequestFlow['operation'];
  durationMs?: string;
} & (
  | { readonly outcome: 'success'; readonly resultCount: CountBucket }
  | ({ readonly outcome: 'failure' } & PackageRequestFailureClassification)
);

/** Only the numeric HTTP status is read. The error's message and cause are never copied into telemetry. */
const failureClassification = (cause: unknown): PackageRequestFailureClassification => {
  if (!Predicate.isObjectOrArray(cause)) return { reason: 'transport' };

  const status = Predicate.hasProperty(cause, 'status')
    ? cause.status
    : Predicate.hasProperty(cause, 'statusCode')
      ? cause.statusCode
      : undefined;

  if (!isHttpErrorStatus(status)) return { reason: 'transport' };

  return status < 500 ? { reason: 'invalid-input', statusClass: '4xx' } : { reason: 'upstream', statusClass: '5xx' };
};

const emit = (
  telemetry: TelemetryRuntime,
  event: string,
  attributes: Readonly<Record<string, string | undefined>>,
): void => {
  telemetry.runSync(Effect.logInfo(event).pipe(Effect.annotateLogs(attributes)));
};

/**
 * Runs one package request and reports its completion. The request's value, rejection, and abort behavior are returned
 * or rethrown exactly as the query received them. Aborts are not reported: a superseded typing query is not a failure.
 */
export const reportPackageRequest = async <Value>(
  telemetry: TelemetryRuntime | undefined,
  flow: PackageRequestFlow,
  signal: AbortSignal,
  request: () => Promise<Value>,
  resultCount: (value: Value) => number,
): Promise<Value> => {
  const startedAt = readClock();

  let value: Value;

  try {
    value = await request();
  } catch (cause) {
    diagnose(() => {
      if (Predicate.isUndefined(telemetry) || signal.aborted) return;

      const annotations: PackageRequestAnnotations = {
        ...failureClassification(cause),
        operation: flow.operation,
        outcome: 'failure',
      };

      if (startedAt !== undefined) annotations.durationMs = telemetryDecimal(performance.now() - startedAt);
      emit(telemetry, flow.event, annotations);
    });

    throw cause;
  }

  diagnose(() => {
    if (Predicate.isUndefined(telemetry) || Math.random() >= PACKAGE_REQUEST_SUCCESS_SAMPLE_RATE) return;

    const annotations: PackageRequestAnnotations = {
      operation: flow.operation,
      outcome: 'success',
      resultCount: countBucket(resultCount(value)),
    };

    if (startedAt !== undefined) annotations.durationMs = telemetryDecimal(performance.now() - startedAt);
    emit(telemetry, flow.event, annotations);
  });

  return value;
};

/**
 * Reports the outcome of one comparison submission. The identity must already be registry-resolved (see
 * comparisonTelemetryAttributes); rejected form input and route text are never passed here.
 */
export const reportComparisonNavigation = (
  telemetry: TelemetryRuntime | undefined,
  navigation: ComparisonNavigationOutcome,
  identity: Readonly<Record<string, string | undefined>> = {},
): void => {
  diagnose(() => {
    if (Predicate.isUndefined(telemetry)) return;

    emit(telemetry, 'comparison.navigation.completed', { ...identity, operation: 'navigation', ...navigation });
  });
};
