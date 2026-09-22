import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';

import { useRequestFetch, useRoute } from '#imports';
import { packageBriefingQueryOptions } from '~/composables/packageBriefingQueryOptions';
import { packageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import { packageMeasurementsQueryOptions } from '~/composables/packageMeasurementsQueryOptions';
import { buildBriefingCitations, resolvedBriefingVersions } from '~/pages/[packageName]/comparisonView';

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
  const briefingQuery = useQuery(packageBriefingQueryOptions(requestFetch, packageName, resolvedFrom, resolvedTo));

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
    measurements: computed(() => measurementsQuery.data.value),
    isDeclarationsPending: computed(() => declarationsQuery.isPending.value),
    isDeclarationsError: computed(() => declarationsQuery.isError.value),
    isMeasurementsPending: computed(() => measurementsQuery.isPending.value),
    isMeasurementsError: computed(() => measurementsQuery.isError.value),
    briefing,
    isBriefingPending: computed(() => briefingQuery.isPending.value),
    briefingError: computed(() => briefingQuery.error.value),
    sources: computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : [])),
    citations: computed(() => {
      const value = briefing.value;
      return value?.status === 'available' ? buildBriefingCitations(value.sources, value.bullets) : [];
    }),
  };
};
