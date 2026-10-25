import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import { Effect, Predicate, Tracer, type Types } from 'effect';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageBriefing } from '#shared/comparison/briefing/briefing.defs';
import type { BriefingSubmission } from '#shared/comparison/briefing/briefingJob.defs';
import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import type { ComparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryDecimal } from '#shared/telemetry/telemetryFields';
import { formatTraceparent } from '#shared/telemetry/traceContext.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

import {
  reportSubscriptionTransition,
  waitForJobEvent,
  type BriefingStatus,
  type SubscriptionOutcome,
  type SubscriptionReason,
  type SubscriptionReporter,
} from './briefingSubscription';
import { comparisonTierTelemetry, runComparisonTier } from './comparisonPageTelemetry';
import { PACKAGE_COMPARISON_STALE_TIME } from './packageComparisonQueryOptions';

export const PACKAGE_BRIEFING_QUERY_KEY_PREFIX = ['npm', 'packages', 'briefing'] as const;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

export type PackageBriefingQueryKey = readonly [...typeof PACKAGE_BRIEFING_QUERY_KEY_PREFIX, string, string, string];

export const packageBriefingQueryKey = (packageName: string, from: string, to: string): PackageBriefingQueryKey => [
  ...PACKAGE_BRIEFING_QUERY_KEY_PREFIX,
  packageName.trim(),
  from.trim(),
  to.trim(),
];

type PackageBriefingQueryContext = QueryFunctionContext<PackageBriefingQueryKey>;

export type PackageBriefingResponse = {
  packageName: string;
  from: string;
  to: string;
  briefing: PackageBriefing;
};

/** A submission the route refused with a sanitized 503 is resubmitted once, after this pause, before the query fails. */
const SUBMISSION_RETRY_DELAY_MS = 250;

/**
 * The sanitized 503 `$fetch` rejects with when the submission route refuses a POST; ofetch exposes the response status
 * under both names. Nothing else is resubmitted: a 200 or 202 resolves, and a failure of another kind is not one a
 * second, hash-addressed submission could answer differently.
 */
const isSanitizedSubmissionFailure = (cause: unknown): boolean => {
  if (!Predicate.isObjectOrArray(cause)) return false;

  return ('status' in cause && cause.status === 503) || ('statusCode' in cause && cause.statusCode === 503);
};

/** Rejects as the query's own signal does when aborted, so a cancelled query never resubmits. */
const pauseBeforeResubmission = (signal: AbortSignal): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const abort = () => reject(signal.reason ?? new Error('The briefing submission was aborted'));

  if (signal.aborted) {
    abort();

    return promise;
  }

  const onAbort = () => {
    clearTimeout(timer);
    abort();
  };

  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, SUBMISSION_RETRY_DELAY_MS);

  signal.addEventListener('abort', onAbort, { once: true });

  return promise;
};

const runBriefingSubmissionAttempt = (
  requestFetch: NuxtRequestFetch,
  url: string,
  packageName: string,
  from: string,
  to: string,
  signal: AbortSignal,
  pageContext?: TraceContext,
  telemetryRuntime?: TelemetryRuntime,
): Promise<BriefingSubmission> => {
  const parent = pageContext === undefined ? undefined : Tracer.externalSpan({ ...pageContext, sampled: true });
  const attributes = comparisonTelemetryAttributes({ packageName, from, to });

  const spanOptions =
    parent === undefined
      ? { kind: 'client' as const, root: true, attributes }
      : { kind: 'client' as const, parent, attributes };

  const operation = Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const traceContext = { traceId: span.traceId, spanId: span.spanId };

    // Key order and precedence match the prior single-object form: attributes are merged last.
    const logAnnotations =
      parent === undefined
        ? { ...traceContext, ...attributes }
        : { ...traceContext, parentSpanId: parent.spanId, ...attributes };

    yield* Effect.logInfo('briefing.submission.started').pipe(Effect.annotateLogs(logAnnotations));

    return yield* Effect.tryPromise({
      try: () =>
        requestFetch<BriefingSubmission>(url, {
          method: 'POST',
          query: { from, to },
          retry: false,
          signal,
          headers: { traceparent: formatTraceparent(traceContext) },
        }),
      catch: (cause) => cause,
    });
  }).pipe(Effect.withSpan('briefing.submit', spanOptions));

  return telemetryRuntime === undefined ? Effect.runPromise(operation) : telemetryRuntime.runPromise(operation);
};

/**
 * The POST that starts one query's submission: one attempt, plus one resubmission when the route answers its sanitized
 * 503. A rejected submission never started a generation, and submissions are hash-addressed, so the resubmission can
 * only rejoin the same job. `retry: false` keeps the query itself from retrying, a 200 or 202 resolves without any
 * resubmission, and an exhausted resubmission surfaces the same sanitized error the page renders today.
 */
const submitBriefing = async (
  requestFetch: NuxtRequestFetch,
  packageName: string,
  from: string,
  to: string,
  signal: AbortSignal,
  pageContext?: TraceContext,
  telemetryRuntime?: TelemetryRuntime,
): Promise<BriefingSubmission> => {
  const url = `/api/package/${encodeURIComponent(packageName)}/compare/briefing`;

  const submit = () =>
    runBriefingSubmissionAttempt(requestFetch, url, packageName, from, to, signal, pageContext, telemetryRuntime);

  try {
    return await submit();
  } catch (error) {
    if (!isSanitizedSubmissionFailure(error)) throw error;
    await pauseBeforeResubmission(signal);

    return await submit();
  }
};

/** The closed field set one transition logs; absent evidence stays absent rather than becoming an empty string. */
type SubscriptionTransitionAnnotations = ComparisonTelemetryAttributes &
  Partial<TraceContext> & {
    readonly operation: 'subscription';
    readonly outcome: SubscriptionOutcome;
    readonly reason?: SubscriptionReason;
    readonly attempt?: string;
    readonly revision?: string;
    readonly durationMs: string;
  };

const createSubscriptionReporter = (
  runtime: TelemetryRuntime | undefined,
  identity: ComparisonTelemetryAttributes,
  pageContext: TraceContext | undefined,
  started: number,
): SubscriptionReporter | undefined => {
  if (runtime === undefined) return undefined;

  return (transition) => {
    const annotations: Types.Mutable<SubscriptionTransitionAnnotations> = {
      ...identity,
      ...pageContext,
      operation: 'subscription',
      outcome: transition.outcome,
      durationMs: telemetryDecimal(Date.now() - started),
    };

    if (transition.reason !== undefined) annotations.reason = transition.reason;

    if (transition.attempt !== undefined) annotations.attempt = telemetryDecimal(transition.attempt);

    if (transition.revision !== undefined) annotations.revision = telemetryDecimal(transition.revision);
    runtime.runSync(Effect.logInfo('briefing.subscription.transition').pipe(Effect.annotateLogs(annotations)));
  };
};

const fetchBriefingResponse = async (
  context: PackageBriefingQueryContext,
  requestFetch: NuxtRequestFetch,
  onStatus: ((state: BriefingStatus) => void) | undefined,
  pageContext: TraceContext | undefined,
  telemetryRuntime: TelemetryRuntime | undefined,
): Promise<PackageBriefingResponse> => {
  const { queryKey, signal } = context;
  const [, , , packageName, from, to] = queryKey;
  // One submission per query, and the browser names nothing but the package and the compared versions: the
  // evidence packet, the hash, the provider call, and the subscription URL stay behind the private binding.
  // `signal` is the query's own: Vue Query cancels the retryer when the last observer detaches — a route change, a
  // comparison swap, an unmount — and the subscription below closes on that abort. That is why nothing here calls
  // the socket off explicitly.
  const response = await submitBriefing(requestFetch, packageName, from, to, signal, pageContext, telemetryRuntime);

  if (response.status === 'available') return response;
  const started = Date.now();

  const identity = comparisonTelemetryAttributes({
    packageName: response.packageName,
    from: response.from,
    to: response.to,
  });

  const report = createSubscriptionReporter(telemetryRuntime, identity, pageContext, started);

  let lastStatus: BriefingStatus = response.status;
  reportSubscriptionTransition(report, { outcome: response.status, revision: response.revision });
  onStatus?.(response.status);

  const briefing = await waitForJobEvent(
    response.eventsUrl,
    response.revision,
    signal,
    (state) => {
      if (state !== lastStatus) {
        lastStatus = state;
        reportSubscriptionTransition(report, { outcome: state });
      }

      onStatus?.(state);
    },
    report,
  );

  return { packageName: response.packageName, from: response.from, to: response.to, briefing };
};

/** Query identity and eligibility share the same normalized, reactive comparison inputs. */
const briefingQueryIdentity = (
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  return {
    queryKey: computed<PackageBriefingQueryKey>(() =>
      packageBriefingQueryKey(normalizedPackageName.value, normalizedFromVersion.value, normalizedToVersion.value),
    ),
    // Briefing is client-only: enabling it during SSR would spend a model call on every page view.
    enabled: computed(
      () =>
        import.meta.client === true &&
        normalizedPackageName.value.length > 0 &&
        normalizedFromVersion.value.length > 0 &&
        normalizedToVersion.value.length > 0,
    ),
  };
};

export const packageBriefingQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  onStatus?: (state: BriefingStatus) => void,
  pageContext?: TraceContext,
  telemetryRuntime?: TelemetryRuntime,
) => {
  const identity = briefingQueryIdentity(packageName, fromVersion, toVersion);

  const diagnostics = comparisonTierTelemetry(telemetryRuntime, pageContext);

  const options = queryOptions({
    queryKey: identity.queryKey,
    queryFn: (context: PackageBriefingQueryContext) =>
      runComparisonTier(
        'briefing',
        diagnostics,
        context.signal,
        context.client.getQueryData(context.queryKey) !== undefined,
        () => fetchBriefingResponse(context, requestFetch, onStatus, pageContext, telemetryRuntime),
        (result) => (result.briefing.status === 'available' ? 'success' : 'unavailable'),
      ),
    enabled: identity.enabled,
    staleTime: PACKAGE_COMPARISON_STALE_TIME,
    retry: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // Client-only: SSR leaves gcTime unset so the Query client default applies on the server.
  if (import.meta.client) {
    options.gcTime = 5 * 60_000;
  }

  return options;
};
