import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';

import { useNuxtApp, useRequestFetch } from '#imports';

import { PACKAGE_SEARCH_DEBOUNCE_MS, packageSearchQueryOptions } from './packageSearchQueryOptions';
import { useDebouncedRef } from './useDebouncedRef';

export const usePackageSearchQuery = (searchTerm: MaybeRefOrGetter<string>) => {
  const debouncedSearchTerm = useDebouncedRef(searchTerm, PACKAGE_SEARCH_DEBOUNCE_MS);
  const requestFetch = useRequestFetch();
  const telemetryRuntime = import.meta.client ? useNuxtApp().$telemetry : undefined;

  return useQuery(packageSearchQueryOptions(requestFetch, debouncedSearchTerm, telemetryRuntime));
};
