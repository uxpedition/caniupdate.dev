import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import { Duration, Effect, Schema, Tracer } from 'effect';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageBriefing } from '#shared/comparison/briefing/briefing.defs';
import {
  decodeBriefingJobEvent,
  type BriefingJobEvent,
  type BriefingSubmission,
} from '#shared/comparison/briefing/briefingJob.defs';
import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { formatTraceparent } from '#shared/telemetry/traceContext.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

import { PACKAGE_COMPARISON_STALE_TIME } from './packageComparisonQueryOptions';

export const PACKAGE_BRIEFING_QUERY_KEY_PREFIX = ['npm', 'packages', 'briefing'] as const;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type PackageBriefingQueryKey = readonly [...typeof PACKAGE_BRIEFING_QUERY_KEY_PREFIX, string, string, string];

type PackageBriefingQueryContext = QueryFunctionContext<PackageBriefingQueryKey>;

export type PackageBriefingResponse = {
  packageName: string;
  from: string;
  to: string;
  briefing: PackageBriefing;
};

/** The generation states a submitted job reports before it settles. */
export type BriefingStatus = 'queued' | 'running';

/** One second, two, then four: the whole backoff one subscription may spend before it gives up. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const SUBSCRIPTION_DEADLINE = Duration.seconds(180);

/** Preserves arbitrary DOM abort reasons without exposing them through a return contract. */
const throwSubscriptionAbort = (signal: AbortSignal): never => {
  if (signal.reason !== undefined) throw signal.reason;
  const abortError = new Error('The briefing subscription was aborted');
  abortError.name = 'AbortError';

  throw abortError;
};

/** A submission the route refused with a sanitized 503 is resubmitted once, after this pause, before the query fails. */
const SUBMISSION_RETRY_DELAY_MS = 250;

/** Any non-null, non-function container: the gate before probing ofetch's rejection shape. */
const isFailureContainer = Schema.is(Schema.Struct({}));

const isScalarString = Schema.is(Schema.String);

/**
 * The sanitized 503 `$fetch` rejects with when the submission route refuses a POST; ofetch exposes the response status
 * under both names. Nothing else is resubmitted: a 200 or 202 resolves, and a failure of another kind is not one a
 * second, hash-addressed submission could answer differently.
 */
const isSanitizedSubmissionFailure = (cause: unknown): boolean => {
  if (!isFailureContainer(cause)) return false;

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
    yield* Effect.logInfo('briefing.submission.started').pipe(
      Effect.annotateLogs({
        ...traceContext,
        ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
        ...attributes,
      }),
    );

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

type CompletedBriefing = { readonly _tag: 'completed'; readonly briefing: PackageBriefing; readonly revision: number };

type SocketOutcome = { readonly _tag: 'disconnected'; readonly revision: number } | CompletedBriefing;

type SocketMessage =
  | { readonly _tag: 'ignored' }
  | { readonly _tag: 'status'; readonly status: BriefingStatus; readonly revision: number }
  | CompletedBriefing;

/** Parses one text frame against the worker's protocol; malformed JSON or a protocol violation yields undefined. */
const decodeJobEventFrame = (data: string): BriefingJobEvent | undefined => {
  try {
    return decodeBriefingJobEvent(JSON.parse(data));
  } catch {
    return undefined;
  }
};

/** Classifies one decoded frame against the highest revision this subscription has already applied. */
const messageFromJobEvent = (frame: BriefingJobEvent, highest: number): SocketMessage => {
  if (frame.revision <= highest) return { _tag: 'ignored' };

  if (frame.status === 'available') return { _tag: 'completed', briefing: frame.briefing, revision: frame.revision };

  if (frame.status === 'unavailable') {
    return {
      _tag: 'completed',
      briefing: { status: 'unavailable', reason: frame.reason, bullets: [], sources: [] },
      revision: frame.revision,
    };
  }

  return { _tag: 'status', status: frame.status, revision: frame.revision };
};

/**
 * Reads one WebSocket message against the worker's protocol and classifies it against the highest applied revision.
 * Non-text, malformed, and off-protocol frames yield undefined; the subscription fails on them.
 */
const messageFromSocketEvent = (event: MessageEvent, highest: number): SocketMessage | undefined => {
  const data: unknown = event.data;
  const frame = isScalarString(data) ? decodeJobEventFrame(data) : undefined;

  return frame === undefined ? undefined : messageFromJobEvent(frame, highest);
};

const reportBriefingStatus = (onStatus: (state: BriefingStatus) => void, state: BriefingStatus): Error | undefined => {
  try {
    onStatus(state);

    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause : new Error('The briefing status could not be updated', { cause });
  }
};

const listenForJobEvents = (
  socket: WebSocket,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.callback<SocketOutcome, Error>((resume) => {
    let highest = revision;
    let resumed = false;

    function onMessage(event: MessageEvent): void {
      const message = messageFromSocketEvent(event, highest);

      if (message === undefined) {
        complete(Effect.fail(new Error('The briefing stream sent a frame the page cannot read')));

        return;
      }

      if (message._tag === 'ignored') return;

      highest = message.revision;

      if (message._tag === 'completed') {
        complete(Effect.succeed(message));

        return;
      }

      const statusError = reportBriefingStatus(onStatus, message.status);

      if (statusError !== undefined) complete(Effect.fail(statusError));
    }

    function onClose(): void {
      complete(Effect.succeed({ _tag: 'disconnected', revision: highest }));
    }

    function detachListeners(): void {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    }

    function complete(effect: Effect.Effect<SocketOutcome, Error>): void {
      if (resumed) return;
      // Effect.callback runs its returned cleanup on interruption only; normal resumption detaches listeners here.
      resumed = true;
      detachListeners();
      resume(effect);
    }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);

    return Effect.sync(detachListeners);
  });

/** Each connection scope owns its socket and listener cleanup. */
const readJobEventSocket = (
  url: string,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WebSocket(url),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error('The briefing socket could not be opened', { cause }),
        }),
        (socket) => Effect.sync(() => socket.close()),
      );

      return yield* listenForJobEvents(socket, revision, onStatus);
    }),
  );

/**
 * Follows one job's socket to a terminal frame. Effect scopes each connection, owns reconnect sleeps, and applies one
 * deadline to the whole subscription. Reconnecting only reads the current snapshot; it never submits another job.
 */
export const waitForJobEvent = async (
  url: string,
  revision: number,
  signal: AbortSignal,
  onStatus: (state: BriefingStatus) => void,
): Promise<PackageBriefing> => {
  if (signal.aborted) throwSubscriptionAbort(signal);

  let highest = revision;

  const subscription = Effect.gen(function* () {
    let attempts = 0;

    while (true) {
      const outcome = yield* readJobEventSocket(url, highest, onStatus);
      highest = outcome.revision;

      if (outcome._tag === 'completed') return outcome.briefing;
      const delay = RECONNECT_DELAYS_MS.at(attempts);

      if (delay === undefined)
        return yield* Effect.fail(new Error('The briefing stream closed before it reported a result'));
      attempts += 1;
      yield* Effect.sleep(Duration.millis(delay));
    }
  });

  const boundedSubscription = Effect.timeoutOrElse(subscription, {
    duration: SUBSCRIPTION_DEADLINE,
    orElse: () => Effect.fail(new Error('The briefing subscription exceeded its 180-second deadline')),
  });

  return Effect.runPromise(boundedSubscription, { signal }).catch((cause: unknown) => {
    if (!signal.aborted) throw cause;

    return throwSubscriptionAbort(signal);
  });
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
  onStatus?.(response.status);
  const briefing = await waitForJobEvent(response.eventsUrl, response.revision, signal, (state) => onStatus?.(state));

  return { packageName: response.packageName, from: response.from, to: response.to, briefing };
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
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  return queryOptions({
    queryKey: computed<PackageBriefingQueryKey>(() => [
      ...PACKAGE_BRIEFING_QUERY_KEY_PREFIX,
      normalizedPackageName.value,
      normalizedFromVersion.value,
      normalizedToVersion.value,
    ]),
    queryFn: (context: PackageBriefingQueryContext) =>
      fetchBriefingResponse(context, requestFetch, onStatus, pageContext, telemetryRuntime),
    // Briefing is client-only: with declarations awaited during SSR, this query would otherwise enable server-side
    // and spend a model call on every page view.
    enabled: computed(
      () =>
        import.meta.client === true &&
        normalizedPackageName.value.length > 0 &&
        normalizedFromVersion.value.length > 0 &&
        normalizedToVersion.value.length > 0,
    ),
    staleTime: PACKAGE_COMPARISON_STALE_TIME,
    retry: false,
    refetchOnWindowFocus: false,
    ...(import.meta.client ? { gcTime: 5 * 60_000 } : {}),
  });
};
