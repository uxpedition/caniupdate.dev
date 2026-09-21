import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageBriefing } from '#shared/briefing.defs';

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

export const packageBriefingQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
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
      return requestFetch<PackageBriefingResponse>(`/api/package/${encodeURIComponent(packageName)}/compare/briefing`, {
        query: { from, to },
        retry: false,
        signal,
      });
    },
    enabled: computed(
      () =>
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
