import { comparisonIdentityPath } from './comparisonRouteIdentity';
import { REVIEWED_COMPARISONS } from './reviewedComparisons';
import { absoluteUrl } from './siteUrl';

export const INDEXABLE_STATIC_PATHS: readonly string[] = ['/', '/about', '/privacy'];

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** Discovery reads reviewed identities, never providers. Response-time declaration failures still enforce noindex. */
export const renderSitemap = (origin: string, indexingEnabled: boolean): string => {
  const paths =
    origin === '' || !indexingEnabled
      ? []
      : [
          ...INDEXABLE_STATIC_PATHS,
          ...REVIEWED_COMPARISONS.map(({ packageName, from, to }) => comparisonIdentityPath(packageName, from, to)),
        ];

  // Review dates are not content modification dates; omit lastmod until that history is available.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `\n  <url><loc>${escapeXml(absoluteUrl(origin, path))}</loc></url>`).join('')}\n</urlset>\n`;
};

export const renderRobots = (origin: string, indexingEnabled: boolean): string =>
  `User-agent: *\nAllow: /\n${origin !== '' && indexingEnabled ? `\nSitemap: ${absoluteUrl(origin, '/sitemap.xml')}\n` : ''}`;
