import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';

import { useNuxtApp, useRequestFetch } from '#imports';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import type { BriefingStatus } from '~/composables/briefingSubscription';
import { packageBriefingQueryOptions, type PackageBriefingResponse } from '~/composables/packageBriefingQueryOptions';

export const useComparisonBriefing = (
  packageName: MaybeRefOrGetter<string>,
  resolvedFrom: MaybeRefOrGetter<string>,
  resolvedTo: MaybeRefOrGetter<string>,
  pageContext?: TraceContext,
) => {
  const requestFetch = useRequestFetch();
  const queryClient = useQueryClient();
  const serverBriefingSeeded = ref(false);
  const telemetryRuntime = import.meta.client ? useNuxtApp().$telemetry : undefined;
  // The generation state the submitted job reports, published by the briefing query as it submits and follows its
  // socket. A comparison change is a different job, so the previous pair's state must not describe the new one.
  const briefingStatus = ref<BriefingStatus | undefined>(undefined);

  const briefingOptions = packageBriefingQueryOptions(
    requestFetch,
    packageName,
    resolvedFrom,
    resolvedTo,
    (state) => (briefingStatus.value = state),
    pageContext,
    telemetryRuntime,
  );

  const briefingQuery = useQuery(briefingOptions);
  watch(briefingOptions.queryKey, () => {
    briefingStatus.value = undefined;
  });

  // Vue Query's SSR observer is not subscribed to later request-cache writes.
  const briefing = computed(() =>
    import.meta.server && serverBriefingSeeded.value
      ? queryClient.getQueryData<PackageBriefingResponse>(toValue(briefingOptions.queryKey))?.briefing
      : briefingQuery.data.value?.briefing,
  );

  return {
    markServerBriefingSeeded: () => {
      serverBriefingSeeded.value = queryClient.getQueryData(toValue(briefingOptions.queryKey)) !== undefined;
    },
    briefing,
    isBriefingPending: computed(() => briefing.value === undefined && briefingQuery.isPending.value),
    briefingStatus,
    briefingError: computed(() => briefingQuery.error.value),
    sources: computed(() => (briefing.value?.status === 'available' ? briefing.value.sources : [])),
  };
};
