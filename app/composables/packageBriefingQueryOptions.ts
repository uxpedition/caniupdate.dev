import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageBriefing } from '#shared/briefing.defs';
import { decodeBriefingJobEvent, type BriefingJobEvent, type BriefingSubmission } from '#shared/briefingJob.defs';

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

/** A submission the route refused with a sanitized 503 is resubmitted once, after this pause, before the query fails. */
const SUBMISSION_RETRY_DELAY_MS = 250;

/**
 * The sanitized 503 `$fetch` rejects with when the submission route refuses a POST; ofetch exposes the response status
 * under both names. Nothing else is resubmitted: a 200 or 202 resolves, and a failure of another kind is not one a
 * second, hash-addressed submission could answer differently.
 */
const isSanitizedSubmissionFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  return ('status' in error && error.status === 503) || ('statusCode' in error && error.statusCode === 503);
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
): Promise<BriefingSubmission> => {
  const submit = () =>
    requestFetch<BriefingSubmission>(`/api/package/${encodeURIComponent(packageName)}/compare/briefing`, {
      method: 'POST',
      query: { from, to },
      retry: false,
      signal,
    });

  try {
    return await submit();
  } catch (error) {
    if (!isSanitizedSubmissionFailure(error)) throw error;
    await pauseBeforeResubmission(signal);
    return await submit();
  }
};

/**
 * Follows one job's socket to its terminal frame: the first snapshot and every later frame are decoded strictly, a
 * frame at or below the highest revision already seen is ignored, and the socket closes on the terminal frame or on
 * abort. A transient disconnect reconnects at most three times with the bounded backoff above and never submits
 * anything — a reconnect only re-reads the current snapshot — so an exhausted subscription rejects rather than
 * spending a second generation.
 */
export const waitForJobEvent = (
  url: string,
  revision: number,
  signal: AbortSignal,
  onStatus: (state: BriefingStatus) => void,
): Promise<PackageBriefing> =>
  new Promise<PackageBriefing>((resolve, reject) => {
    let highest = revision;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let closeCurrentSocket = () => {};

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      signal.removeEventListener('abort', onAbort);
      closeCurrentSocket();
      outcome();
    };

    const onAbort = () => {
      finish(() => reject(signal.reason ?? new Error('The briefing subscription was aborted')));
    };

    const connect = () => {
      const socket = new WebSocket(url);
      let closed = false;
      closeCurrentSocket = () => {
        if (closed) return;
        closed = true;
        socket.close();
      };

      socket.addEventListener('message', (event: MessageEvent) => {
        if (settled) return;
        let frame: BriefingJobEvent | undefined;
        if (typeof event.data === 'string') {
          try {
            frame = decodeBriefingJobEvent(JSON.parse(event.data));
          } catch {
            frame = undefined;
          }
        }
        if (frame === undefined) {
          finish(() => reject(new Error('The briefing stream sent a frame the page cannot read')));
          return;
        }
        if (frame.revision <= highest) return;
        highest = frame.revision;
        if (frame.status === 'available') {
          const briefing = frame.briefing;
          finish(() => resolve(briefing));
          return;
        }
        if (frame.status === 'unavailable') {
          const reason = frame.reason;
          finish(() => resolve({ status: 'unavailable', reason, bullets: [], sources: [] }));
          return;
        }
        onStatus(frame.status);
      });

      // The service closes every socket it settles, so a close without a terminal frame is a disconnect, not an end.
      socket.addEventListener('close', () => {
        closed = true;
        if (settled) return;
        const delay = RECONNECT_DELAYS_MS.at(attempts);
        if (delay === undefined) {
          finish(() => reject(new Error('The briefing stream closed before it reported a result')));
          return;
        }
        attempts += 1;
        timer = setTimeout(() => {
          timer = undefined;
          connect();
        }, delay);
      });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    connect();
  });

export const packageBriefingQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  onStatus?: (state: BriefingStatus) => void,
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
    queryFn: async ({ queryKey, signal }: PackageBriefingQueryContext): Promise<PackageBriefingResponse> => {
      const [, , , packageName, from, to] = queryKey;
      // One submission per query, and the browser names nothing but the package and the compared versions: the
      // evidence packet, the hash, the provider call, and the subscription URL stay behind the private binding.
      // `signal` is the query's own: Vue Query cancels the retryer when the last observer detaches — a route change, a
      // comparison swap, an unmount — and the subscription below closes on that abort. That is why nothing here calls
      // the socket off explicitly.
      const response = await submitBriefing(requestFetch, packageName, from, to, signal);
      if (response.status === 'available') return response;
      onStatus?.(response.status);
      const briefing = await waitForJobEvent(response.eventsUrl, response.revision, signal, (state) =>
        onStatus?.(state),
      );
      return { packageName: response.packageName, from: response.from, to: response.to, briefing };
    },
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
