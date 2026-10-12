import { queryOptions } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { ParsedPackageMetadata } from '#shared/comparison/package/package.defs';

export const PACKAGE_METADATA_QUERY_KEY_PREFIX = ['npm', 'packages', 'metadata'] as const;

export const PACKAGE_METADATA_STALE_TIME = 60_000;

type NuxtRequestFetch = H3Event$Fetch | $Fetch;

type PackageMetadataQueryKey = readonly [...typeof PACKAGE_METADATA_QUERY_KEY_PREFIX, string];

type PackageMetadataQueryContext = QueryFunctionContext<PackageMetadataQueryKey>;

export const packageMetadataQueryOptions = (
  requestFetch: NuxtRequestFetch,
  packageName: MaybeRefOrGetter<string | null>,
) => {
  const normalizedPackageName = computed(() => toValue(packageName)?.trim() ?? '');

  const options = queryOptions({
    queryKey: computed<PackageMetadataQueryKey>(() => [
      ...PACKAGE_METADATA_QUERY_KEY_PREFIX,
      normalizedPackageName.value,
    ]),
    queryFn: async ({ queryKey, signal }: PackageMetadataQueryContext): Promise<ParsedPackageMetadata> => {
      const packageName = queryKey[3];

      return requestFetch<ParsedPackageMetadata>(`/api/package/${encodeURIComponent(packageName)}`, {
        retry: false,
        signal,
      });
    },
    enabled: computed(() => normalizedPackageName.value.length > 0),
    staleTime: PACKAGE_METADATA_STALE_TIME,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Client-only: SSR leaves gcTime unset so the Query client default applies on the server.
  if (import.meta.client) {
    options.gcTime = 5 * 60_000;
  }

  return options;
};
