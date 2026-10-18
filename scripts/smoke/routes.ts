import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { Schema } from 'effect';
import { Miniflare } from 'miniflare';

// Exercise the deployable bundle without backend bindings, persisted state, migrations,
// provider credentials, or generation. These routes need only public request admission.
const script = await readFile('.output/workers/frontend/index.js', 'utf8');

const decodePublicError = Schema.decodeUnknownSync(
  Schema.Struct({
    error: Schema.Literal(true),
    statusCode: Schema.Number,
    statusMessage: Schema.String,
    message: Schema.String,
    url: Schema.String,
    data: Schema.optionalKey(Schema.Unknown),
    stack: Schema.optionalKey(Schema.Never),
  }),
);

const runtime = (protectedRequests: boolean, limit = 60) =>
  new Miniflare({
    workers: [
      {
        config: {
          name: 'route-smoke',
          compatibilityDate: '2026-09-25',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: script } },
          },
          env: protectedRequests
            ? { PUBLIC_RATE_LIMITER: { type: 'rate-limit', namespace: '1001', simple: { limit, period: 60 } } }
            : {},
        },
      },
    ],
  });

const admitted = runtime(true);

const unavailable = runtime(false);

const exhausted = runtime(true, 1);

const assertSecurityHeaders = (response: { status: number; headers: { get(name: string): string | null } }): void => {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(
    response.headers.get('referrer-policy'),
    response.status >= 400 ? 'no-referrer' : 'strict-origin-when-cross-origin',
  );
};

try {
  for (const path of ['/sitemap.xml', '/definitely-not-a-real-page-launch-check', '/missing/nested/path']) {
    for (const accept of ['text/html', 'application/json']) {
      const response = await admitted.dispatchFetch(`https://example.test${path}`, { headers: { accept } });
      assert.equal(response.status, 404, `${path} (${accept})`);
      assertSecurityHeaders(response);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      const body = decodePublicError(await response.json());
      assert.equal(body.statusCode, 404);
      console.log(`${path} (${accept}) -> 404`);
    }
  }

  for (const path of [
    '/',
    '/about',
    '/privacy',
    '/api/health',
    '/is-number/7.0.0...7.0.0',
    '/@vue%2Fshared/3.5.0...3.5.0',
  ]) {
    const response = await admitted.dispatchFetch(`https://example.test${path}`);
    assert.equal(response.status, 200, path);
    assertSecurityHeaders(response);
    console.log(`${path} -> 200`);
  }

  // Invalid API input is rejected before provider I/O; no paid/provider work is dispatched.
  const invalid = await admitted.dispatchFetch('https://example.test/api/package/vue/compare');
  assert.equal(invalid.status, 400);
  assertSecurityHeaders(invalid);

  for (const path of ['/', '/api/health', '/sitemap.xml', '/__nuxt_error']) {
    for (const accept of ['text/html', 'application/json']) {
      const response = await unavailable.dispatchFetch(`https://example.test${path}`, {
        headers: { accept, 'x-nuxt-error': 'true' },
      });

      assert.equal(response.status, 503, `${path} must fail closed`);
      assertSecurityHeaders(response);
      const body = decodePublicError(await response.json());
      assert.equal(body.statusMessage, 'Request protection unavailable');
      console.log(`unavailable protection: ${path} (${accept}) -> 503`);
    }
  }

  assert.equal((await exhausted.dispatchFetch('https://example.test/api/health')).status, 200);

  for (const accept of ['text/html', 'application/json']) {
    const response = await exhausted.dispatchFetch('https://example.test/sitemap.xml', { headers: { accept } });
    assert.equal(response.status, 429);
    assertSecurityHeaders(response);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = decodePublicError(await response.json());
    assert.deepEqual(body.data, { code: 'request-rate-limited', retryAfter: 60 });
    console.log(`exhausted protection: /sitemap.xml (${accept}) -> 429`);
  }
} finally {
  await Promise.all([admitted.dispose(), unavailable.dispose(), exhausted.dispose()]);
}
