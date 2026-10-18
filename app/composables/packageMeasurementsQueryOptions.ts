import { queryOptions } from '@tanstack/vue-query';
import type { QueryClient, QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch, NitroFetchOptions } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import { formatTraceparent } from '#shared/telemetry/traceContext.defs';

import { runComparisonTier } from './comparisonPageTelemetry';
import type { ComparisonTierTelemetry } from './comparisonPageTelemetry';
import { PACKAGE_COMPARISON_STALE_TIME } from './packageComparisonQueryOptions';

export const PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX = ['npm', 'packages', 'measurements'] as const;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type PackageMeasurementsQueryKey = readonly [...typeof PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX, string, string, string];

type PackageMeasurementsQueryContext = QueryFunctionContext<PackageMeasurementsQueryKey>;

const loadMeasurements = (
  { queryKey, signal, client }: PackageMeasurementsQueryContext,
  requestFetch: NuxtRequestFetch,
  diagnostics: ComparisonTierTelemetry | undefined,
): Promise<PackageMeasurementsResponse> => {
  const [, , , packageName, from, to] = queryKey;

  return runComparisonTier(
    'measurements',
    diagnostics,
    signal,
    client.getQueryData(queryKey) !== undefined,
    (context) => {
      const options: NitroFetchOptions<string> = { query: { from, to }, retry: false, signal };

      if (context !== undefined) options.headers = { traceparent: formatTraceparent(context) };

      return requestFetch<PackageMeasurementsResponse>(
        `/api/package/${encodeURIComponent(packageName)}/compare/measurements`,
        options,
      );
    },
    (result) =>
      result.comparison.advisories.status !== 'available' ||
      result.from.tarball.status !== 'available' ||
      result.to.tarball.status !== 'available' ||
      result.from.bundleSize.status !== 'available' ||
      result.to.bundleSize.status !== 'available'
        ? 'partial'
        : 'success',
  );
};

export const packageMeasurementsQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  diagnostics?: ComparisonTierTelemetry,
) => {
  const normalizedPackageName = computed(() => toValue(packageName).trim());
  const normalizedFromVersion = computed(() => toValue(fromVersion).trim());
  const normalizedToVersion = computed(() => toValue(toVersion).trim());

  const options = queryOptions({
    queryKey: computed<PackageMeasurementsQueryKey>(() => [
      ...PACKAGE_MEASUREMENTS_QUERY_KEY_PREFIX,
      normalizedPackageName.value,
      normalizedFromVersion.value,
      normalizedToVersion.value,
    ]),
    queryFn: (context: PackageMeasurementsQueryContext) => loadMeasurements(context, requestFetch, diagnostics),
    // Automatic collection is client-only. SSR explicitly prefetches eligible reviewed comparisons
    // and stored briefing hits rather than collecting expensive evidence for every route.
    enabled: computed(
      () =>
        import.meta.client === true &&
        normalizedPackageName.value.length > 0 &&
        normalizedFromVersion.value.length > 0 &&
        normalizedToVersion.value.length > 0,
    ),
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

/** Prefetch measurements during SSR and remove failures so the browser can start from a pending query state. */
export const prefetchPackageMeasurements = async (
  requestFetch: NuxtRequestFetch,
  queryClient: QueryClient,
  packageName: string,
  fromVersion: string,
  toVersion: string,
): Promise<boolean> => {
  const options = packageMeasurementsQueryOptions(requestFetch, packageName, fromVersion, toVersion);
  await queryClient.query(options).catch(() => undefined);

  if (queryClient.getQueryState(options.queryKey)?.status === 'success') return true;

  queryClient.removeQueries({ queryKey: options.queryKey });

  return false;
};
