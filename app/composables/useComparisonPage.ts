import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';

import { useRequestFetch, useRoute } from '#imports';
import { packageBriefingQueryOptions, type BriefingStatus } from '~/composables/packageBriefingQueryOptions';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import { packageMeasurementsQueryOptions } from '~/composables/packageMeasurementsQueryOptions';
import { resolvedBriefingVersions } from '~/pages/[packageName]/comparisonView';

const useComparisonRoute = () => {
  const route = useRoute();
  const packageName = computed(() => (typeof route.params.packageName === 'string' ? route.params.packageName : ''));
  const versions = computed(() => {
    const pair = typeof route.params.versionPair === 'string' ? route.params.versionPair : '';
    const [from = '', to = ''] = pair.split('...');
    return { from, to };
  });
  const fromVersion = computed(() => versions.value.from);
  const toVersion = computed(() => versions.value.to);
  return { packageName, fromVersion, toVersion };
};

export const useComparisonPage = async () => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const requestFetch = useRequestFetch();
  const queryClient = useQueryClient();

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
  // The generation state the submitted job reports, published by the briefing query as it submits and follows its
  // socket. A comparison change is a different job, so the previous pair's state must not describe the new one.
  const briefingStatus = ref<BriefingStatus | undefined>(undefined);
  const briefingOptions = packageBriefingQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo, (state) => {
    briefingStatus.value = state;
  });
  const briefingQuery = useQuery(briefingOptions);
  watch(briefingOptions.queryKey, () => {
    briefingStatus.value = undefined;
  });

  if (import.meta.server) {
    // Declarations must be in the first paint. A failed prefetch is not dehydrated, so drop it and let the client
    // retry from a pending state instead of hydrating an error the server already rendered.
    await queryClient.prefetchQuery(declarationsOptions);
    if (queryClient.getQueryState(declarationsOptions.queryKey)?.status !== 'success') {
      queryClient.removeQueries({ queryKey: declarationsOptions.queryKey });
    }
  }

  const briefing = computed(() => briefingQuery.data.value?.briefing);

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
    isBriefingPending: computed(() => briefingQuery.isPending.value),
    briefingStatus,
    briefingError: computed(() => briefingQuery.error.value),
    sources: computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : [])),
  };
};
