import assert from 'node:assert/strict';

import type { Response } from 'miniflare';

import { comparisonIdentityPath } from '../../../app/composables/comparisonRouteIdentity.ts';
import { REVIEWED_COMPARISONS } from '../../../shared/site/reviewedComparisons.ts';
import { comparisonStatusRuntime } from './comparisonStatus.ts';

const staticPaths = ['/', '/about', '/privacy'];

const reviewedPaths = REVIEWED_COMPARISONS.map(({ packageName, from, to }) =>
  comparisonIdentityPath(packageName, from, to),
);

const excludedPaths = [
  '/typescript/7.0.2...6.0.3',
  '/typescript/6.0.3...6.0.3',
  '/typescript/4.9.5...5.0.4',
  '/chalk/4.1.2...5.0.0',
  '/measurement-fixture/1.0.0...2.0.0',
];

const verifyPage = async (response: Response, path: string, indexingEnabled: boolean): Promise<void> => {
  const html = await response.text();
  const eligible = indexingEnabled && (staticPaths.includes(path) || reviewedPaths.includes(path));

  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('x-robots-tag'), eligible ? null : 'noindex, follow', path);
  assert.ok(html.includes(`rel="canonical" href="https://caniupdate.dev${path}"`), `${path}: exact canonical identity`);

  if (reviewedPaths.includes(path)) {
    assert.ok(html.includes('overview-heading'), `${path}: useful SSR facts`);
    assert.ok(html.includes('Package declarations alone do not'), `${path}: clear coverage limit without AI`);
  }

  console.log(
    `${indexingEnabled ? 'production' : 'nonproduction'} ${path}: ${eligible ? 'eligible' : 'noindex'}, canonical verified`,
  );
};

const verifyEnvironment = async (indexingEnabled: boolean): Promise<void> => {
  const runtime = await comparisonStatusRuntime(0, { indexingEnabled });

  try {
    const origin = (await runtime.ready).origin;

    for (const path of [...staticPaths, ...reviewedPaths, ...excludedPaths]) {
      await verifyPage(await runtime.dispatchFetch(`${origin}${path}`), path, indexingEnabled);
    }

    const tracked = await runtime.dispatchFetch(`${origin}/typescript/6.0.3...7.0.2?utm_source=pilot`);
    assert.equal(tracked.headers.get('x-robots-tag'), indexingEnabled ? null : 'noindex, follow');
    assert.ok(
      (await tracked.text()).includes('rel="canonical" href="https://caniupdate.dev/typescript/6.0.3...7.0.2"'),
    );
  } finally {
    await runtime.dispose();
  }
};

const verifyReviewedFailure = async (reviewedEvidence: 'unavailable' | 'thin'): Promise<void> => {
  const runtime = await comparisonStatusRuntime(0, { indexingEnabled: true, reviewedEvidence });

  try {
    for (const path of reviewedPaths) {
      const response = await runtime.dispatchFetch(`${(await runtime.ready).origin}${path}`);
      const html = await response.text();
      assert.equal(response.status, reviewedEvidence === 'unavailable' ? 503 : 200, path);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow', path);
      assert.ok(html.includes(`rel="canonical" href="https://caniupdate.dev${path}"`), path);
      console.log(`production ${path} ${reviewedEvidence} declarations: noindex, identity retained`);
    }
  } finally {
    await runtime.dispose();
  }
};

export const verifyComparisonIndexing = async (): Promise<void> => {
  for (const indexingEnabled of [false, true]) await verifyEnvironment(indexingEnabled);

  for (const evidence of ['unavailable', 'thin'] as const) await verifyReviewedFailure(evidence);
};
