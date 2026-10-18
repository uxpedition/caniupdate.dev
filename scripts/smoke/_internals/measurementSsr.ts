import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Miniflare, Response } from 'miniflare';
import type { BrowserType, Page } from 'playwright';

import { comparisonStatusRuntime } from './comparisonStatus.ts';

const measurementSsrPath = '/typescript/6.0.3...7.0.2';

type MeasurementMode = 'missing' | 'stored' | 'partial' | 'unavailable' | 'read-error';

const assertMeasurementHtml = async (response: Response, mode: MeasurementMode) => {
  const html = await response.text();
  const overview = html.match(/<section[^>]*aria-labelledby="overview-heading"[^>]*>([\s\S]*?)<\/section>/)?.[1];

  assert.equal(response.status, 200, mode);
  assert.ok(overview, `${mode}: overview in ordinary HTML`);
  assert.equal(
    overview.includes('2026-10-18T10:00:00.000Z'),
    mode !== 'unavailable',
    `${mode}: measured retrieval time`,
  );
  assert.ok(!html.includes('private-provider-marker'), 'private errors stay private');
  assert.equal(html.includes('Stored fixture interpretation.'), mode === 'stored', 'only stored notes hydrate');

  if (mode === 'partial') assert.ok(!overview.includes('0 matched'), 'unknown advisories are not zero findings');

  assert.equal(
    response.headers.get('cloudflare-cdn-cache-control')?.includes('max-age=43200') ?? false,
    mode === 'stored',
    'measurements alone never enable edge HTML caching',
  );

  return overview;
};

const verifyUnreviewedBounds = async (runtime: Miniflare, origin: string) => {
  for (const path of ['/measurement-fixture/1.0.0...2.0.0', '/typescript/7.0.2...6.0.3']) {
    const response = await runtime.dispatchFetch(`${origin}${path}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(!html.includes('2026-10-18T10:00:00.000Z'), 'unreviewed miss does not prefetch measurements');
  }

  const fixture = await runtime.getWorker('measurement-ssr-fixture');

  assert.deepEqual(
    await (await fixture.fetch('https://fixture/counts')).json(),
    { measurements: 2, evidence: 4, reads: 4, submissions: 0 },
    'arbitrary and reverse routes retain stored-hit-only measurement SSR',
  );
};

/** Real built frontend and private bindings; the fixture has no queue or job namespace to mutate. */
export const verifyMeasurementSsr = async () => {
  for (const measurements of ['missing', 'stored', 'partial', 'unavailable', 'read-error'] as const) {
    const runtime = await comparisonStatusRuntime(0, { measurements });

    try {
      const origin = (await runtime.ready).origin;
      const overviews: string[] = [];

      for (const userAgent of ['Mozilla/5.0', 'Googlebot']) {
        const response = await runtime.dispatchFetch(`${origin}${measurementSsrPath}`, {
          headers: { 'user-agent': userAgent },
        });

        overviews.push(await assertMeasurementHtml(response, measurements));
      }

      assert.equal(overviews[0], overviews[1], `${measurements}: crawler and ordinary substantive facts`);
      const fixture = await runtime.getWorker('measurement-ssr-fixture');
      const counts = await (await fixture.fetch('https://fixture/counts')).json();

      assert.deepEqual(
        counts,
        { measurements: 2, evidence: 2, reads: 2, submissions: 0 },
        `${measurements}: one measurement and read per GET, no generation or job binding`,
      );

      if (measurements === 'missing') await verifyUnreviewedBounds(runtime, origin);
      console.log(`${measurements}: initial measurement HTML, crawler parity, bounded reads, no submission`);
    } finally {
      await runtime.dispose();
    }
  }
};

const exerciseMeasurementNavigation = async (page: Page, origin: string, name: string) => {
  assert.equal((await page.goto(`${origin}${measurementSsrPath}`))?.status(), 200);
  const overview = page.locator('section[aria-labelledby="overview-heading"]');

  await overview.locator('summary').click();
  await overview.locator('time').first().waitFor();
  const initial = await overview.innerText();
  const evidenceDirectory = await mkdtemp(join(tmpdir(), 'issue-12-browser-'));

  await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
  await page.locator('nav a[href="/"]').click();
  await page.waitForURL(`${origin}/`);
  await page.goBack();
  await overview.locator('summary').click();
  await overview.locator('time').first().waitFor();
  assert.equal(await overview.innerText(), initial, 'cached measurement facts survive client navigation');
  console.log(`${name}: measured overview hydrates and survives home/back navigation; screenshot ${evidenceDirectory}`);
};

export const verifyMeasurementHydration = async (
  engine: BrowserType,
  measurements: 'stored' | 'missing' = 'stored',
) => {
  const runtime = await comparisonStatusRuntime(0, { measurements });
  const browser = await engine.launch({ headless: true });

  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await exerciseMeasurementNavigation(page, (await runtime.ready).origin, `${engine.name()}-${measurements}`);
    assert.deepEqual(errors, [], `${engine.name()}: hydration and navigation errors`);
  } finally {
    await browser.close();
    await runtime.dispose();
  }
};
