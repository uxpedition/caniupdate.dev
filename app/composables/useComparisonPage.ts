import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { QueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';

import { useRequestFetch } from '#imports';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import type { PackageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import { packageMeasurementsQueryOptions } from '~/composables/packageMeasurementsQueryOptions';
import { useComparisonBriefing } from '~/composables/useComparisonBriefing';
import { useComparisonRoute } from '~/composables/useComparisonRoute';
import { resolvedBriefingVersions } from '~/pages/[packageName]/comparisonView';

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

export const useComparisonPage = async (pageTraceContext?: TraceContext) => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const requestFetch = useRequestFetch();

  // Every query is created before the server prefetch below: vue-query resolves its client through injection, so it
  // must run inside the synchronous setup scope, never after an await.
  const declarationsOptions = packageComparisonQueryOptions(requestFetch, packageName, fromVersion, toVersion);
  const declarationsQuery = useQuery(declarationsOptions);
  const declarations = computed(() => declarationsQuery.data.value);
  const resolved = computed(() => resolvedBriefingVersions(declarations.value));
  const resolvedFrom = computed(() => resolved.value.from);
  const resolvedTo = computed(() => resolved.value.to);
  const measurementsQuery = useQuery(
    packageMeasurementsQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo),
  );
  const measurements = computed(() => measurementsQuery.data.value);
  // Cached measurements remain renderable after a failed refetch; only an error without resolved data is unavailable.
  const isMeasurementsUnavailable = computed(() => measurementsQuery.isError.value && measurements.value === undefined);

  const { briefing, isBriefingPending, briefingStatus, briefingError, sources } = useComparisonBriefing(
    packageName,
    resolvedFrom,
    resolvedTo,
    pageTraceContext,
  );

  await prefetchDeclarations(useQueryClient(), declarationsOptions);

  return {
    packageName,
    displayFromVersion: computed(() => declarations.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => declarations.value?.to.version ?? toVersion.value),
    declarations,
    measurements,
    isDeclarationsPending: computed(() => declarationsQuery.isPending.value),
    isDeclarationsError: computed(() => declarationsQuery.isError.value),
    isMeasurementsPending: computed(() => measurementsQuery.isPending.value),
    isMeasurementsUnavailable,
    briefing,
    isBriefingPending,
    briefingStatus,
    briefingError,
    sources,
  };
};
