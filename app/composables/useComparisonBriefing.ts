import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

import { useRequestFetch } from '#imports';
import { packageBriefingQueryOptions, type BriefingStatus } from '~/composables/packageBriefingQueryOptions';

export const useComparisonBriefing = (
  packageName: MaybeRefOrGetter<string>,
  resolvedFrom: MaybeRefOrGetter<string>,
  resolvedTo: MaybeRefOrGetter<string>,
) => {
  const requestFetch = useRequestFetch();
  // The generation state the submitted job reports, published by the briefing query as it submits and follows its
  // socket. A comparison change is a different job, so the previous pair's state must not describe the new one.
  const briefingStatus = ref<BriefingStatus | undefined>(undefined);
  const briefingOptions = packageBriefingQueryOptions(
    requestFetch,
    packageName,
    resolvedFrom,
    resolvedTo,
    (state) => (briefingStatus.value = state),
  );
  const briefingQuery = useQuery(briefingOptions);
  watch(briefingOptions.queryKey, () => {
    briefingStatus.value = undefined;
  });
  const briefing = computed(() => briefingQuery.data.value?.briefing);

  return {
    briefing,
    isBriefingPending: computed(() => briefingQuery.isPending.value),
    briefingStatus,
    briefingError: computed(() => briefingQuery.error.value),
    sources: computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : [])),
  };
};
