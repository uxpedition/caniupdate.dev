import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { QueryClient } from '@tanstack/vue-query';
import type { H3Event } from 'h3';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue';

import { setResponseStatus, useNuxtApp, useRequestEvent, useRequestFetch } from '#imports';
import type { PackageDeclarationsResponse, PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import { rateLimitMessage } from '#shared/request/rateLimit.defs';
import { isReviewedComparisonIndexable } from '#shared/site/reviewedComparisons';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import { prefetchDeclarations } from '~/composables/comparisonDeclarationsPrefetch';
import { comparisonTierTelemetry } from '~/composables/comparisonPageTelemetry';
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
    markServerPrefetched,
    state: {
      measurements,
      isMeasurementsPending: isPending,
      isMeasurementsUnavailable: isUnavailable,
      measurementsRateLimitMessage: computed(() => rateLimitMessage(query.error.value)),
      retryMeasurements: () => query.refetch(),
    },
  };
};

const useComparisonDeclarationsQuery = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
  tierTelemetry: ComparisonTierTelemetry | undefined,
) => {
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

  return {
    declarationsOptions,
    declarations,
    resolvedFrom: computed(() => resolved.value.from),
    resolvedTo: computed(() => resolved.value.to),
    declarationState: {
      declarations,
      isDeclarationsPending,
      isDeclarationsError: computed(() => declarationsQuery.isError.value),
      declarationsRateLimitMessage: computed(() => rateLimitMessage(declarationsQuery.error.value)),
      retryDeclarations: () => declarationsQuery.refetch(),
    },
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

  const tierTelemetry = comparisonTierTelemetry(runtime, pageTraceContext);

  const declarations = useComparisonDeclarationsQuery(requestFetch, packageName, fromVersion, toVersion, tierTelemetry);

  const measurements = useComparisonMeasurementsQuery(
    requestFetch,
    packageName,
    declarations.resolvedFrom,
    declarations.resolvedTo,
    tierTelemetry,
  );

  const { markServerBriefingSeeded, ...briefing } = useComparisonBriefing(
    packageName,
    declarations.resolvedFrom,
    declarations.resolvedTo,
    pageTraceContext,
  );

  return {
    ...declarations,
    measurements: measurements.state,
    markServerMeasurementsPrefetched: measurements.markServerPrefetched,
    briefing,
    markServerBriefingSeeded,
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

/** Complete declaration status and identity work before considering the independent stored tiers. */
const prefetchPageDeclarations = async (
  queryClient: QueryClient,
  options: PackageComparisonQueryOptions,
  requestEvent: H3Event | undefined,
  declarations: () => PackageDeclarationsResponse | undefined,
  convergeIdentity: () => Promise<void>,
): Promise<void> => {
  const failureStatus = await prefetchDeclarations(queryClient, options);

  // Use Nuxt's status bridge: app-side H3 and Nitro can use different event implementations.
  if (requestEvent !== undefined && failureStatus !== undefined) setResponseStatus(requestEvent, failureStatus);

  if (requestEvent !== undefined) {
    requestEvent.context.comparisonIndexable = isReviewedComparisonIndexable(declarations());
  }

  await convergeIdentity();
};

export const useComparisonPage = async (pageTraceContext?: TraceContext) => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const requestFetch = useRequestFetch();
  const requestEvent = import.meta.server ? useRequestEvent() : undefined;
  const queryClient = useQueryClient();

  const queries = useComparisonPageQueries(requestFetch, packageName, fromVersion, toVersion, pageTraceContext);

  const convergeIdentity = useComparisonIdentity(queries.declarations, queries.declarationsOptions);

  if (import.meta.server) {
    await prefetchPageDeclarations(
      queryClient,
      queries.declarationsOptions,
      requestEvent,
      () => queries.declarations.value,
      convergeIdentity,
    );
  }

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
    queries.markServerBriefingSeeded();
  }

  return {
    packageName,
    displayFromVersion: computed(() => queries.declarations.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => queries.declarations.value?.to.version ?? toVersion.value),
    ...queries.declarationState,
    ...queries.measurements,
    ...queries.briefing,
  };
};
