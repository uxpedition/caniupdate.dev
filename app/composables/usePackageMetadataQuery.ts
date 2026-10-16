import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';

import { useNuxtApp, useRequestFetch } from '#imports';

import { packageMetadataQueryOptions } from './packageMetadataQueryOptions';

export const usePackageMetadataQuery = (packageName: MaybeRefOrGetter<string | null>) => {
  const requestFetch = useRequestFetch();
  const telemetryRuntime = import.meta.client ? useNuxtApp().$telemetry : undefined;

  return useQuery(packageMetadataQueryOptions(requestFetch, packageName, telemetryRuntime));
};
