/**
 * The site's public origin — `NUXT_PUBLIC_SITE_URL` — names the scheme, host, and optional port this deployment
 * publishes under. Everything absolute (canonical links, social URLs, the sitemap) is built from this value, so
 * it is never derived from a request's `Host` or forwarded headers: a dev hostname or an alias cannot leak into a
 * canonical address. A configured value must therefore be an origin and nothing else — a path, query, fragment, or
 * credential is a configuration error, not a silently ignored part of a URL.
 */

export const PRODUCTION_SITE_ORIGIN = 'https://caniupdate.dev';

export type SiteOriginParse =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

/** This machine's own address as the URL parser writes it: `localhost`, dotted IPv4, or bracketed IPv6. */
const LOCAL_HOSTNAME = /^(?:localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3})$/;

/** Why `url` cannot serve as a public origin, or `undefined` when it can. */
const originRejection = (url: URL): string | undefined => {
  if (url.username !== '' || url.password !== '') {
    return 'must not contain credentials';
  }

  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return 'must be an origin without a path, query, or fragment';
  }

  // Plain http is meaningful for a dev runtime served on this machine's own address — the loopback alias, or the LAN or
  // Tailscale IP literal a laptop opens — but never for a public hostname, which must be https.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTNAME.test(url.hostname))) {
    return 'must use https, or http for a local address';
  }

  return undefined;
};

/** The normalized origin in `value`, or why `value` cannot serve as one. */
export const parseSiteOrigin = (value: string | undefined): SiteOriginParse => {
  const candidate = value?.trim() ?? '';

  if (candidate === '') {
    return { ok: false, reason: 'is not set' };
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'must be an absolute URL, for example https://caniupdate.dev' };
  }

  const rejection = originRejection(url);

  return rejection === undefined ? { ok: true, origin: url.origin } : { ok: false, reason: rejection };
};

/**
 * The absolute address of `path` under `origin`. The path is assigned rather than concatenated so the URL parser
 * handles it: an encoded scoped-package name keeps its `%2F` and a prerelease identifier keeps its hyphens and dots,
 * while a caller that passes a query or fragment gets an address that carries neither — canonical addresses never do.
 */
export const absoluteUrl = (origin: string, path: string): string => {
  const url = new URL(origin);

  url.pathname = path.split(/[?#]/, 1)[0] ?? path;

  return url.href;
};
