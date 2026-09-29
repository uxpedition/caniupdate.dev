import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageMeasurementsResponse } from '#shared/comparison.defs';

import { PACKAGE_COMPARISON_STALE_TIME } from './packageComparisonQueryOptions';

export const PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX = ['npm', 'packages', 'measurements'] as const;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;
type PackageMeasurementsQueryKey = readonly [...typeof PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX, string, string, string];
type PackageMeasurementsQueryContext = QueryFunctionContext<PackageMeasurementsQueryKey>;

export const packageMeasurementsQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  return queryOptions({
    queryKey: computed<PackageMeasurementsQueryKey>(() => [
      ...PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX,
      normalizedPackageName.value,
      normalizedFromVersion.value,
      normalizedToVersion.value,
    ]),
    queryFn: async ({ queryKey, signal }: PackageMeasurementsQueryContext): Promise<PackageMeasurementsResponse> => {
      const [, , , packageName, from, to] = queryKey;

      return requestFetch<PackageMeasurementsResponse>(
        `/api/package/${encodeURIComponent(packageName)}/compare/measurements`,
        { query: { from, to }, retry: false, signal },
      );
    },
    // Measurements are client-only: awaiting declarations during SSR would otherwise enable this query and collect
    // tarballs, OSV, and Bundlephobia evidence on the server for every page view.
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
