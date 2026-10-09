import { computed, useRoute, useRuntimeConfig } from '#imports';
import { absoluteUrl } from '#shared/site/siteUrl';

/**
 * The absolute address of the current route under the configured public origin, or `undefined` when this session has
 * no configured origin — a local run without `NUXT_PUBLIC_SITE_URL` emits no canonical link rather than a guessed one.
 * The route path is used exactly as the router reports it, so the address always names the page the browser is on; it
 * is built from configuration, never from the request's `Host` or forwarded headers.
 */
export const useCanonicalUrl = () => {
  const route = useRoute();
  const siteUrl = useRuntimeConfig().public.siteUrl;

  return computed(() => (siteUrl === '' ? undefined : absoluteUrl(siteUrl, route.path)));
};
