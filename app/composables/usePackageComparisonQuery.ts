import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';

import { useRequestFetch } from '#imports';

import { packageComparisonQueryOptions } from './packageComparisonQueryOptions';

export const usePackageComparisonQuery = (
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const requestFetch = useRequestFetch();

  return useQuery(packageComparisonQueryOptions(requestFetch, packageName, fromVersion, toVersion));
};
