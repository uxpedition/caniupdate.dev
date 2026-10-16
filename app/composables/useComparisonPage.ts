import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { QueryClient } from '@tanstack/vue-query';
import type { H3Event } from 'h3';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, type MaybeRefOrGetter } from 'vue';

import { useNuxtApp, useRequestEvent, useRequestFetch } from '#imports';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import { prefetchStoredComparison, readStoredComparisonBriefing } from '~/composables/comparisonSsrPrefetch';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import type { PackageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import {
  packageMeasurementsQueryOptions,
  prefetchPackageMeasurements,
} from '~/composables/packageMeasurementsQueryOptions';
import { useComparisonBriefing } from '~/composables/useComparisonBriefing';
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
  const resolved = computed(() => resolvedBriefingVersions(declarations.value));
  const resolvedFrom = computed(() => resolved.value.from);
  const resolvedTo = computed(() => resolved.value.to);

  const measurementsQuery = useQuery(
    packageMeasurementsQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo, tierTelemetry),
  );
  const measurements = computed(() => measurementsQuery.data.value);
  const isMeasurementsUnavailable = computed(() => measurementsQuery.isError.value && measurements.value === undefined);
  const briefing = useComparisonBriefing(packageName, resolvedFrom, resolvedTo, pageTraceContext);

  return {
    declarationsOptions,
    declarationsQuery,
    declarations,
    resolvedFrom,
    resolvedTo,
    measurementsQuery,
    measurements,
    isMeasurementsUnavailable,
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

  await prefetchDeclarations(queryClient, queries.declarationsOptions);
  await prefetchComparisonForSsr({
    requestEvent,
    requestFetch,
    queryClient,
    packageName: packageName.value,
    from: queries.resolvedFrom.value,
    to: queries.resolvedTo.value,
  });

  return {
    packageName,
    displayFromVersion: computed(() => queries.declarations.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => queries.declarations.value?.to.version ?? toVersion.value),
    declarations: queries.declarations,
    measurements: queries.measurements,
    isDeclarationsPending: computed(() => queries.declarationsQuery.isPending.value),
    isDeclarationsError: computed(() => queries.declarationsQuery.isError.value),
    isMeasurementsPending: computed(() => queries.measurementsQuery.isPending.value),
    isMeasurementsUnavailable: queries.isMeasurementsUnavailable,
    briefing: queries.briefing.briefing,
    isBriefingPending: queries.briefing.isBriefingPending,
    briefingStatus: queries.briefing.briefingStatus,
    briefingError: queries.briefing.briefingError,
    sources: queries.briefing.sources,
  };
};
