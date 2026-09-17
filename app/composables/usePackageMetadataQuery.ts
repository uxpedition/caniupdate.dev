import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';

import { useRequestFetch } from '#imports';

import { packageMetadataQueryOptions } from './packageMetadataQueryOptions';

export const usePackageMetadataQuery = (packageName: MaybeRefOrGetter<string | null>) => {
  const requestFetch = useRequestFetch();

  return useQuery(packageMetadataQueryOptions(requestFetch, packageName));
};
