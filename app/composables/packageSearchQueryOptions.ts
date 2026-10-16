import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { ParsedPackagesSearchResult } from '#shared/comparison/package/search.defs';
import type { TelemetryRuntime } from '#shared/telemetry/telemetry';

import { PACKAGE_SEARCH_FLOW, reportPackageRequest } from './flowTelemetry';

export const PACKAGE_SEARCH_QUERY_KEY_PREFIX = ['npm', 'packages', 'search'] as const;

export const PACKAGE_SEARCH_DEBOUNCE_MS = 200;

export const PACKAGE_SEARCH_STALE_TIME = 60_000;

const PACKAGE_SEARCH_SIZE = 20;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type PackageSearchQueryKey = readonly [...typeof PACKAGE_SEARCH_QUERY_KEY_PREFIX, string];

type PackageSearchQueryContext = QueryFunctionContext<PackageSearchQueryKey>;

export const packageSearchQueryOptions = (
  requestFetch: NuxtRequestFetch,
  searchTerm: MaybeRefOrGetter<string>,
  telemetryRuntime?: TelemetryRuntime,
) => {
  const normalizedSearchTerm = computed(() => toValue(searchTerm).trim());

  const options = queryOptions({
    queryKey: computed<PackageSearchQueryKey>(() => [...PACKAGE_SEARCH_QUERY_KEY_PREFIX, normalizedSearchTerm.value]),
    queryFn: async ({ queryKey, signal }: PackageSearchQueryContext): Promise<ParsedPackagesSearchResult> => {
      const text = queryKey[3];

      return reportPackageRequest(
        telemetryRuntime,
        PACKAGE_SEARCH_FLOW,
        signal,
        () =>
          requestFetch<ParsedPackagesSearchResult>('/api/search', {
            query: { text, size: PACKAGE_SEARCH_SIZE },
            retry: false,
            signal,
          }),
        (result) => result.data.length,
      );
    },
    enabled: computed(() => normalizedSearchTerm.value.length >= 2),
    staleTime: PACKAGE_SEARCH_STALE_TIME,
    retry: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // Client-only: SSR leaves gcTime unset so the Query client default applies on the server.
  if (import.meta.client) {
    options.gcTime = 5 * 60_000;
  }

  return options;
};
