import assert from 'node:assert/strict';

import { chromium, firefox } from 'playwright';

import { comparisonStatusRuntime } from './_internals/comparisonStatus.ts';

const serve = process.argv.includes('--serve');

const runtime = await comparisonStatusRuntime(serve ? 5273 : 0);

try {
  const origin = (await runtime.ready).origin;

  if (serve) {
    console.log(`Comparison status fixtures ready at ${origin}`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } else {
    for (const [path, status] of [
      ['/measurement-fixture/not-a-pair', 400],
      ['/measurement-fixture/1.0.0...', 400],
      ['/measurement-fixture/1.0.0...2.0.0...3.0.0', 400],
      ['/unknown-fixture/1.0.0...2.0.0', 404],
      ['/measurement-fixture/1.0.0...9.9.9', 404],
      ['/unavailable-fixture/1.0.0...2.0.0', 503],
      ['/measurement-fixture/1.0.0...2.0.0', 200],
      ['/api/package/unknown-fixture/compare?from=1.0.0&to=2.0.0', 404],
      ['/api/package/unavailable-fixture/compare?from=1.0.0&to=2.0.0', 503],
      ['/api/package/measurement-fixture/compare/measurements?from=1.0.0&to=2.0.0', 503],
    ] as const) {
      const response = await runtime.dispatchFetch(`${origin}${path}`, { headers: { accept: 'text/html' } });
      const body = await response.text();
      assert.equal(response.status, status, path);
      assert.ok(!body.includes('private-provider-marker'), `${path}: provider details must stay private`);

      if (status !== 200 && response.headers.get('content-type')?.startsWith('text/html')) {
        assert.equal(response.headers.get('cache-control'), 'no-store', path);
        assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store', path);
      }

      if (status === 200)
        assert.ok(body.includes('comparison-node'), 'useful declaration HTML survives measurement failure');

      if (path.startsWith('/unavailable-fixture'))
        assert.ok(body.includes('unavailable-fixture'), 'retain route identity');
      console.log(`${path} -> ${status}`);
    }

    for (const engine of process.argv.includes('--browsers') ? [chromium, firefox] : []) {
      // Fresh fixture failures for each browser; only public registry calls are replaced.
      const recovery = await comparisonStatusRuntime();
      const browser = await engine.launch({ headless: true });

      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const url = `${(await recovery.ready).origin}/recovery-fixture/1.0.0...2.0.0`;
        const response = await page.goto(url);
        assert.equal(response?.status(), 503, `${engine.name()}: initial SSR failure`);
        await page.locator('#comparison-node').waitFor();
        assert.equal(await page.locator('h1').textContent(), 'recovery-fixture');
        assert.equal(page.url(), url, 'recovery retains comparison identity');
        assert.deepEqual(errors, [], `${engine.name()}: hydration errors`);
        assert.equal((await page.reload())?.status(), 200, 'reload succeeds after registry recovery');
        await page.locator('#comparison-node').waitFor();
        console.log(`${engine.name()}: SSR 503 -> client declaration recovery -> reload 200`);
      } finally {
        await browser.close();
        await recovery.dispose();
      }
    }
  }
} finally {
  await runtime.dispose();
}
