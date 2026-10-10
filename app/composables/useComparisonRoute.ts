import { computed } from 'vue';

import { useRoute } from '#imports';

// The route names the comparison: a shell that only reads these params can paint without waiting for any fetch.
export const useComparisonRoute = () => {
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
