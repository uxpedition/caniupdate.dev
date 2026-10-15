import { getRequestURL, getResponseHeader, getResponseStatus, setResponseHeader } from 'h3';
import type { H3Event } from 'h3';

const ONE_YEAR_EDGE_TTL_SECONDS = 31_536_000;

const LONG_LIVED_PAGE_PATHS: readonly string[] = ['/', '/privacy', '/about'];

const COMPARISON_EDGE_TTL_SECONDS = 43_200;

const noStore = (event: H3Event): void => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  setResponseHeader(event, 'Cloudflare-CDN-Cache-Control', 'no-store');
};

const cacheHtmlAtEdge = (event: H3Event, ttlSeconds: number): void => {
  // Browsers must revalidate; Cloudflare's higher-precedence directive owns the edge TTL and forbids stale serving.
  setResponseHeader(event, 'Cache-Control', 'no-cache');
  setResponseHeader(event, 'Cloudflare-CDN-Cache-Control', `public, max-age=${ttlSeconds}, must-revalidate`);
};

/** Only complete, public HTML gets an edge TTL; every other Nitro response opts out of heuristic caching. */
export const applyResponseCachePolicy = (event: H3Event): void => {
  const contentType = getResponseHeader(event, 'content-type');

  const isHtmlGet =
    event.method === 'GET' &&
    getResponseStatus(event) === 200 &&
    contentType?.toLowerCase().startsWith('text/html') === true;

  if (!isHtmlGet) {
    noStore(event);

    return;
  }

  const pathname = getRequestURL(event).pathname;

  if (LONG_LIVED_PAGE_PATHS.includes(pathname)) {
    cacheHtmlAtEdge(event, ONE_YEAR_EDGE_TTL_SECONDS);

    return;
  }

  if (event.context.comparisonHtmlCacheable === true) {
    cacheHtmlAtEdge(event, COMPARISON_EDGE_TTL_SECONDS);

    return;
  }

  noStore(event);
};
