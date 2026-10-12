import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageDeclarationsResponse } from '#shared/comparison/comparison.defs';

export const PACKAGE_COMPARISON_QUERY_KEY_PREFIX = ['npm', 'packages', 'comparison'] as const;

export const PACKAGE_COMPARISON_STALE_TIME = 60_000;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type PackageComparisonQueryKey = readonly [...typeof PACKAGE_COMPARISON_QUERY_KEY_PREFIX, string, string, string];

type PackageComparisonQueryContext = QueryFunctionContext<PackageComparisonQueryKey>;

/** The reactive declaration-query options handle shared by `useQuery`, prefetch, and cache removal. */
export type PackageComparisonQueryOptions = ReturnType<typeof packageComparisonQueryOptions>;

export const packageComparisonQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  const options = queryOptions({
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
  });

  // Client-only: SSR leaves gcTime unset so the Query client default applies on the server.
  if (import.meta.client) {
    options.gcTime = 5 * 60_000;
  }

  return options;
};
