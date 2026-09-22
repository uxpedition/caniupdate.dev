import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageDeclarationsResponse } from '#shared/comparison.defs';

export const PACKAGE_COMPARISON_QUERY_KEY_PREFIX = ['npm', 'packages', 'comparison'] as const;
export const PACKAGE_COMPARISON_STALE_TIME = 60_000;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;
type PackageComparisonQueryKey = readonly [...typeof PACKAGE_COMPARISON_QUERY_KEY_PREFIX, string, string, string];
type PackageComparisonQueryContext = QueryFunctionContext<PackageComparisonQueryKey>;

export const packageComparisonQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  return queryOptions({
    queryKey: computed<PackageComparisonQueryKey>(() => [
      ...PACKAGE_COMPARISON_QUERY_KEY_PREFIX,
      normalizedPackageName.value,
      normalizedFromVersion.value,
      normalizedToVersion.value,
    ]),
    queryFn: async ({ queryKey, signal }: PackageComparisonQueryContext): Promise<PackageDeclarationsResponse> => {
      const [, , , packageName, from, to] = queryKey;
      return requestFetch<PackageDeclarationsResponse>(`/api/package/${encodeURIComponent(packageName)}/compare`, {
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
