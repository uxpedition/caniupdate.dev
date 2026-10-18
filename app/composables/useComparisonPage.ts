import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { QueryClient } from '@tanstack/vue-query';
import type { H3Event } from 'h3';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue';

import { useNuxtApp, useRequestEvent, useRequestFetch } from '#imports';
import type { PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import { rateLimitMessage } from '#shared/request/rateLimit.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import type { ComparisonTierTelemetry } from '~/composables/comparisonPageTelemetry';
import { prefetchStoredComparison, readStoredComparisonBriefing } from '~/composables/comparisonSsrPrefetch';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import type { PackageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import {
  packageMeasurementsQueryOptions,
  prefetchPackageMeasurements,
} from '~/composables/packageMeasurementsQueryOptions';
import { useComparisonBriefing } from '~/composables/useComparisonBriefing';
import { useComparisonIdentity } from '~/composables/useComparisonIdentity';
import { useComparisonRoute } from '~/composables/useComparisonRoute';
import { resolvedBriefingVersions } from '~/pages/[packageName]/comparisonView';

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

// Declarations must be in the first paint. A failed prefetch is not dehydrated, so drop it and let the client retry
// from a pending state instead of hydrating an error the server already rendered.
const prefetchDeclarations = async (queryClient: QueryClient, declarationsOptions: PackageComparisonQueryOptions) => {
  if (import.meta.server) {
    await queryClient.query(declarationsOptions).catch(() => undefined);

    if (queryClient.getQueryState(declarationsOptions.queryKey)?.status !== 'success') {
      queryClient.removeQueries({ queryKey: declarationsOptions.queryKey });
    }
  }
};

const useComparisonMeasurementsQuery = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  tierTelemetry?: ComparisonTierTelemetry,
) => {
  const queryClient = useQueryClient();
  const serverPrefetched = ref(false);
  const options = packageMeasurementsQueryOptions(requestFetch, packageName, fromVersion, toVersion, tierTelemetry);
  const query = useQuery(options);

  // SSR observers keep their initial snapshot after the request cache is populated.
  const measurements = computed(() => {
    if (!import.meta.server || !serverPrefetched.value) return query.data.value;

    return queryClient.getQueryData<PackageMeasurementsResponse>(toValue(options.queryKey)) ?? query.data.value;
  });

  const isPending = computed(() => measurements.value === undefined && query.isPending.value);
  const isUnavailable = computed(() => query.isError.value && measurements.value === undefined);

  const markServerPrefetched = () => {
    serverPrefetched.value = import.meta.server;
  };

  return {
    measurements,
    isPending,
    isUnavailable,
    markServerPrefetched,
    rateLimitMessage: computed(() => rateLimitMessage(query.error.value)),
    retry: () => query.refetch(),
  };
};

/** Create every reactive query synchronously before the page composable awaits server work. */
const useComparisonPageQueries = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  pageTraceContext?: TraceContext,
) => {
  const runtime = import.meta.client ? useNuxtApp().$telemetry : undefined;

  const tierTelemetry =
    runtime === undefined
      ? undefined
      : pageTraceContext === undefined
        ? { runtime }
        : { runtime, context: pageTraceContext };

  const declarationsOptions = packageComparisonQueryOptions(
    requestFetch,
    packageName,
    fromVersion,
    toVersion,
    tierTelemetry,
  );

  const declarationsQuery = useQuery(declarationsOptions);
  const declarations = computed(() => declarationsQuery.data.value);
  const isDeclarationsPending = computed(() => declarations.value === undefined && declarationsQuery.isPending.value);
  const resolved = computed(() => resolvedBriefingVersions(declarations.value));
  const resolvedFrom = computed(() => resolved.value.from);
  const resolvedTo = computed(() => resolved.value.to);

  const measurements = useComparisonMeasurementsQuery(
    requestFetch,
    packageName,
    resolvedFrom,
    resolvedTo,
    tierTelemetry,
  );

  const briefing = useComparisonBriefing(packageName, resolvedFrom, resolvedTo, pageTraceContext);

  return {
    declarationsOptions,
    declarationsQuery,
    declarations,
    isDeclarationsPending,
    resolvedFrom,
    resolvedTo,
    measurements: measurements.measurements,
    isMeasurementsPending: measurements.isPending,
    isMeasurementsUnavailable: measurements.isUnavailable,
    measurementsRateLimitMessage: measurements.rateLimitMessage,
    retryMeasurements: measurements.retry,
    markServerMeasurementsPrefetched: measurements.markServerPrefetched,
    briefing,
  };
};

const prefetchComparisonForSsr = async ({
  requestEvent,
  requestFetch,
  queryClient,
  packageName,
  from,
  to,
}: {
  readonly requestEvent: H3Event | undefined;
  readonly requestFetch: NuxtRequestFetch;
  readonly queryClient: QueryClient;
  readonly packageName: string;
  readonly from: string;
  readonly to: string;
}): Promise<void> => {
  const normalizedPackage = packageName.trim();
  const normalizedFrom = from.trim();
  const normalizedTo = to.trim();

  if (requestEvent === undefined || normalizedPackage === '' || normalizedFrom === '' || normalizedTo === '') {
    return;
  }

  await prefetchStoredComparison({
    readStoredBriefing: () =>
      readStoredComparisonBriefing(requestFetch, normalizedPackage, normalizedFrom, normalizedTo),
    prefetchMeasurements: () =>
      prefetchPackageMeasurements(requestFetch, queryClient, normalizedPackage, normalizedFrom, normalizedTo),
    queryClient,
    event: requestEvent,
    packageName: normalizedPackage,
    from: normalizedFrom,
    to: normalizedTo,
  });
};

export const useComparisonPage = async (pageTraceContext?: TraceContext) => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const requestFetch = useRequestFetch();
  const requestEvent = import.meta.server ? useRequestEvent() : undefined;
  const queryClient = useQueryClient();

  const queries = useComparisonPageQueries(requestFetch, packageName, fromVersion, toVersion, pageTraceContext);

  const convergeIdentity = useComparisonIdentity(queries.declarations, queries.declarationsOptions);

  await prefetchDeclarations(queryClient, queries.declarationsOptions);

  if (import.meta.server) await convergeIdentity();

  await prefetchComparisonForSsr({
    requestEvent,
    requestFetch,
    queryClient,
    packageName: packageName.value,
    from: queries.resolvedFrom.value,
    to: queries.resolvedTo.value,
  });

  queries.markServerMeasurementsPrefetched();

  if (import.meta.server) {
    queries.briefing.markServerBriefingSeeded();
  }

  return {
    packageName,
    displayFromVersion: computed(() => queries.declarations.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => queries.declarations.value?.to.version ?? toVersion.value),
    declarations: queries.declarations,
    measurements: queries.measurements,
    isDeclarationsPending: queries.isDeclarationsPending,
    isDeclarationsError: computed(() => queries.declarationsQuery.isError.value),
    declarationsRateLimitMessage: computed(() => rateLimitMessage(queries.declarationsQuery.error.value)),
    retryDeclarations: () => queries.declarationsQuery.refetch(),
    isMeasurementsPending: queries.isMeasurementsPending,
    isMeasurementsUnavailable: queries.isMeasurementsUnavailable,
    measurementsRateLimitMessage: queries.measurementsRateLimitMessage,
    retryMeasurements: queries.retryMeasurements,
    briefing: queries.briefing.briefing,
    isBriefingPending: queries.briefing.isBriefingPending,
    briefingStatus: queries.briefing.briefingStatus,
    briefingError: queries.briefing.briefingError,
    retryBriefing: queries.briefing.retryBriefing,
    sources: queries.briefing.sources,
  };
};
