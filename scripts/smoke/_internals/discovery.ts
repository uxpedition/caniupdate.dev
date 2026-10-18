import assert from 'node:assert/strict';

import type { Miniflare } from 'miniflare';

import { comparisonIdentityPath } from '../../../shared/site/comparisonRouteIdentity.ts';
import { REVIEWED_COMPARISONS } from '../../../shared/site/reviewedComparisons.ts';
import { comparisonStatusRuntime } from './comparisonStatus.ts';

const reviewedPaths = REVIEWED_COMPARISONS.map(({ packageName, from, to }) =>
  comparisonIdentityPath(packageName, from, to),
);

const readDiscovery = async (runtime: Miniflare, indexingEnabled: boolean): Promise<string[]> => {
  const origin = (await runtime.ready).origin;
  const sitemap = await runtime.dispatchFetch(`${origin}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal(sitemap.headers.get('cache-control'), 'no-store');

  const xml = await sitemap.text();
  const robots = await runtime.dispatchFetch(`${origin}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.equal(robots.headers.get('cache-control'), 'no-store');
  assert.equal((await robots.text()).includes('Sitemap: https://caniupdate.dev/sitemap.xml'), indexingEnabled);
  assert.ok(!xml.includes('<lastmod>'), 'review dates must not become content modification dates');

  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
  assert.deepEqual(
    listed,
    indexingEnabled ? ['/', '/about', '/privacy', ...reviewedPaths].map((path) => `https://caniupdate.dev${path}`) : [],
  );

  return listed;
};

const verifyListedPages = async (runtime: Miniflare, urls: string[]): Promise<void> => {
  for (const url of urls) {
    const response = await runtime.dispatchFetch(`${(await runtime.ready).origin}${new URL(url).pathname}`);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('x-robots-tag'), null, url);
    assert.ok((await response.text()).includes(`rel="canonical" href="${url}"`), url);
  }
};

export const verifyDiscovery = async (): Promise<void> => {
  for (const indexingEnabled of [false, true]) {
    let providerRequests = 0;

    const runtime = await comparisonStatusRuntime(0, {
      indexingEnabled,
      onProviderRequest: () => {
        providerRequests += 1;
      },
    });

    try {
      const listed = await readDiscovery(runtime, indexingEnabled);
      assert.equal(providerRequests, 0, 'sitemap and robots rendering must not collect provider evidence');
      await verifyListedPages(runtime, listed);
      console.log(
        `${indexingEnabled ? 'production' : 'nonproduction'} discovery: ${listed.length} sitemap URLs, zero discovery provider requests`,
      );
    } finally {
      await runtime.dispose();
    }
  }
};
