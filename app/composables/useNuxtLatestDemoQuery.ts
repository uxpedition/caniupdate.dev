import { queryOptions, useQuery } from '@tanstack/vue-query';
import type { QueryFunctionContext } from '@tanstack/vue-query';
import type { $Fetch, H3Event$Fetch } from 'nitropack/types';

import { useRequestFetch } from '#imports';

export const NUXT_LATEST_QUERY_KEY = ['npm', 'package', 'nuxt', 'latest'] as const;

export type NuxtLatestPackage = {
  name: string;
  version: string;
};

type NuxtLatestQueryContext = QueryFunctionContext<typeof NUXT_LATEST_QUERY_KEY>;
type NuxtRequestFetch = H3Event$Fetch | $Fetch;

export const nuxtLatestQueryOptions = (requestFetch: NuxtRequestFetch) =>
  queryOptions({
    queryKey: NUXT_LATEST_QUERY_KEY,
    queryFn: async ({ signal }: NuxtLatestQueryContext): Promise<NuxtLatestPackage> =>
      await requestFetch<NuxtLatestPackage>('/api/demo/nuxt-latest', {
        retry: false,
        signal,
      }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    ...(import.meta.client ? { gcTime: 5 * 60_000 } : {}),
  });

export const useNuxtLatestQuery = () => {
  const requestFetch = useRequestFetch();

  return useQuery(nuxtLatestQueryOptions(requestFetch));
};
