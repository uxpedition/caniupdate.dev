import { Schema } from 'effect';

import { computed, useRoute, useRuntimeConfig } from '#imports';
import { comparisonIdentityPath, substantiveSearch } from '#shared/site/comparisonRouteIdentity';
import { absoluteUrl } from '#shared/site/siteUrl';

const isString = Schema.is(Schema.String);

/**
 * The absolute address of the current route under the configured public origin, or `undefined` when this session has
 * no configured origin — a local run without `NUXT_PUBLIC_SITE_URL` emits no canonical link rather than a guessed one.
 * Known tracking parameters are omitted; unknown query parameters retain their identity. The origin comes from
 * configuration, never from the request's `Host` or forwarded headers.
 */
export const useCanonicalUrl = () => {
  const route = useRoute();
  const siteUrl = useRuntimeConfig().public.siteUrl;

  return computed(() => {
    if (siteUrl === '') return undefined;

    const fullPath = route.fullPath.split('#', 1)[0] ?? route.path;
    const search = fullPath.includes('?') ? fullPath.slice(fullPath.indexOf('?')) : '';
    const { packageName, versionPair } = route.params;
    const [from = '', to = ''] = isString(versionPair) ? versionPair.split('...') : [];

    const path =
      route.name === 'packageName-versionPair' && isString(packageName)
        ? comparisonIdentityPath(packageName, from, to)
        : route.path;

    return `${absoluteUrl(siteUrl, path)}${substantiveSearch(search)}`;
  });
};
