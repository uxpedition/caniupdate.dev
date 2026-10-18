import { useQueryClient } from '@tanstack/vue-query';
import { toValue, watch, type ComputedRef } from 'vue';

import { navigateTo, useNuxtApp, useRequestURL, useRoute } from '#imports';
import type { PackageDeclarationsResponse } from '#shared/comparison/comparison.defs';
import { comparisonRedirect } from '~/composables/comparisonRouteIdentity';
import type { PackageComparisonQueryOptions } from '~/composables/packageComparisonQueryOptions';
import { useComparisonRoute } from '~/composables/useComparisonRoute';

/** Converge only successful data for the active query; late results must not rename a different comparison. */
export const useComparisonIdentity = (
  declarations: ComputedRef<PackageDeclarationsResponse | undefined>,
  options: PackageComparisonQueryOptions,
) => {
  const queryClient = useQueryClient();
  const nuxtApp = useNuxtApp();
  const route = useRoute();
  const { packageName, fromVersion, toVersion } = useComparisonRoute();
  // Nuxt decodes some path characters. Compare the actual request/address-bar bytes to avoid scoped redirect loops.
  const requestPath = import.meta.server ? useRequestURL().pathname : undefined;

  const converge = async () => {
    const data = queryClient.getQueryData<PackageDeclarationsResponse>(toValue(options.queryKey));

    if (data === undefined) return;

    const redirect = comparisonRedirect(
      requestPath ?? window.location.pathname,
      packageName.value,
      fromVersion.value,
      toVersion.value,
      data.from.version,
      data.to.version,
    );

    if (redirect === undefined) return;

    // Decoded params can be identical for formatting aliases; force Router to replace their spelling too.
    await nuxtApp.runWithContext(() =>
      navigateTo(
        { path: redirect.path, query: route.query, hash: route.hash, force: true },
        { redirectCode: redirect.redirectCode, replace: true },
      ),
    );
  };

  // A cached comparison can keep the same data object across a formatting-only navigation.
  if (import.meta.client) watch([() => route.fullPath, declarations], converge, { immediate: true });

  return converge;
};
