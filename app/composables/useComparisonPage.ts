import { computed } from 'vue';

import { useRoute } from '#imports';
import { usePackageBriefingQuery } from '~/composables/usePackageBriefingQuery';
import { usePackageComparisonQuery } from '~/composables/usePackageComparisonQuery';
import {
  buildBriefingCitations,
  buildComparisonRows,
  resolvedBriefingVersions,
} from '~/pages/[packageName]/comparisonView';

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

export const useComparisonPage = () => {
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  const comparisonQuery = usePackageComparisonQuery(packageName, fromVersion, toVersion);
  const comparisonData = computed(() => comparisonQuery.data.value);
  const briefingVersions = computed(() => resolvedBriefingVersions(comparisonData.value));
  const briefingQuery = usePackageBriefingQuery(
    packageName,
    computed(() => briefingVersions.value.from),
    computed(() => briefingVersions.value.to),
  );
  const comparisonRows = computed(() => {
    const data = comparisonData.value;
    return data === undefined ? [] : buildComparisonRows(data.from, data.to, data.comparison);
  });
  const briefing = computed(() => briefingQuery.data.value?.briefing);
  const sources = computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : []));
  const citations = computed(() => {
    const value = briefing.value;
    return value?.status === 'available' ? buildBriefingCitations(value.sources, value.bullets) : [];
  });

  return {
    packageName,
    displayFromVersion: computed(() => comparisonData.value?.from.version ?? fromVersion.value),
    displayToVersion: computed(() => comparisonData.value?.to.version ?? toVersion.value),
    comparisonData,
    comparisonRows,
    isComparisonPending: computed(() => comparisonQuery.isPending.value),
    isComparisonError: computed(() => comparisonQuery.isError.value),
    isBriefingPending: computed(() => briefingQuery.isPending.value),
    briefingError: computed(() => briefingQuery.error.value),
    briefing,
    sources,
    citations,
  };
};
