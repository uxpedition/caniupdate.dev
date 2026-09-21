import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';

import { useRequestFetch } from '#imports';

import { packageBriefingQueryOptions } from './packageBriefingQueryOptions';

export const usePackageBriefingQuery = (
  packageName: MaybeRefOrGetter<string>,
  fromVersion: MaybeRefOrGetter<string>,
  toVersion: MaybeRefOrGetter<string>,
) => {
  const requestFetch = useRequestFetch();

  return useQuery(packageBriefingQueryOptions(requestFetch, packageName, fromVersion, toVersion));
};
