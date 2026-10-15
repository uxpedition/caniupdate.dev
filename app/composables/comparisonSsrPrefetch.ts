import type { QueryClient } from '@tanstack/vue-query';
import type { H3Event } from 'h3';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';

import { decodeStoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';
import type { StoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';
import { packageBriefingQueryKey, type PackageBriefingResponse } from '~/composables/packageBriefingQueryOptions';

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type StoredComparisonPrefetch = {
  readonly readStoredBriefing: () => Promise<StoredBriefingResult>;
  readonly prefetchMeasurements: () => Promise<boolean>;
  readonly queryClient: QueryClient;
  readonly event: Pick<H3Event, 'context'>;
  readonly packageName: string;
  readonly from: string;
  readonly to: string;
};

const matchesRequestedIdentity = (
  stored: StoredBriefingResult,
  packageName: string,
  from: string,
  to: string,
): stored is Extract<StoredBriefingResult, { status: 'available' }> =>
  stored.status === 'available' && stored.packageName === packageName && stored.from === from && stored.to === to;

/** Fetch and strictly decode the stored result for the exact server-resolved comparison. */
export const readStoredComparisonBriefing = async (
  requestFetch: NuxtRequestFetch,
  packageName: string,
  from: string,
  to: string,
): Promise<StoredBriefingResult> =>
  decodeStoredBriefingResult(
    await requestFetch<unknown>(`/api/package/${encodeURIComponent(packageName)}/compare/briefing`, {
      query: { from, to },
      retry: false,
    }),
  );

/** Hydrate a public stored success; only a complete SSR comparison becomes edge-cacheable. */
export const prefetchStoredComparison = async ({
  readStoredBriefing,
  prefetchMeasurements,
  queryClient,
  event,
  packageName,
  from,
  to,
}: StoredComparisonPrefetch): Promise<void> => {
  if (packageName.trim() === '' || from.trim() === '' || to.trim() === '') return;

  try {
    const stored = await readStoredBriefing();

    if (!matchesRequestedIdentity(stored, packageName, from, to)) return;

    queryClient.setQueryData<PackageBriefingResponse>(packageBriefingQueryKey(packageName, from, to), {
      packageName: stored.packageName,
      from: stored.from,
      to: stored.to,
      briefing: stored.briefing,
    });

    if (!(await prefetchMeasurements())) return;

    event.context.comparisonHtmlCacheable = true;
  } catch {
    // Evidence, storage, or protocol failures opt out of caching and preserve the browser's existing POST path.
  }
};
