import { mockEvent } from 'h3';
import { describe, expect, it, vi } from 'vitest';

import middleware from '../middleware/rateLimit';
import { admitPublicRequest } from './rateLimit';

const eventFor = (path: string, success = true) => {
  const event = mockEvent(`https://example.test${path}`, {
    headers: { 'cf-connecting-ip': '198.51.100.99', 'x-forwarded-for': '198.51.100.98' },
  });

  const limit = vi.fn(async () => ({ success }));
  event.context.cloudflare = {
    request: new Request(`https://example.test${path}`, { headers: { 'cf-connecting-ip': '192.0.2.1' } }),
    env: { PUBLIC_RATE_LIMITER: { limit } },
  };

  return { event, limit };
};

describe('public request admission', () => {
  it.each([
    '/api/search?q=vue',
    '/api/package/vue',
    '/api/package/vue/compare/measurements',
    '/vue/1.0.0...2.0.0',
    '/',
    '/about',
    '/privacy',
    '/api/health',
    '/api/telemetry/config',
    '/_nuxt/asset.js',
    '/missing/nested/path',
  ])('rejects %s before handing control to its handler', async (path) => {
    const { event } = eventFor(path, false);
    await expect(middleware(event)).rejects.toMatchObject({
      statusCode: 429,
      data: { code: 'request-rate-limited', retryAfter: 60 },
    });
    expect(event.res.headers.get('retry-after')).toBe('60');
    expect(event.res.headers.get('cache-control')).toBe('no-store');
  });

  it('derives private identity only from the original platform request and admits SSR-local fetches once', async () => {
    const { event, limit } = eventFor('/api/package/vue/compare');
    const first = await admitPublicRequest(event);

    const subrequest = mockEvent('https://example.test/api/package/vue/compare/briefing', {
      headers: { 'cf-connecting-ip': '203.0.113.99' },
    });

    subrequest.context.cloudflare = event.context.cloudflare;
    expect(await admitPublicRequest(subrequest)).toEqual(first);
    expect(limit).toHaveBeenCalledTimes(1);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('192.0.2.1'));
    expect(first.key).toBe(Buffer.from(digest).toString('hex'));
    expect(JSON.stringify(first)).not.toContain('192.0.2.1');
  });

  it('fails closed when the binding is absent or fails', async () => {
    await expect(admitPublicRequest(mockEvent('https://example.test/api/search'))).rejects.toMatchObject({
      statusCode: 503,
    });
    const { event, limit } = eventFor('/api/search');
    limit.mockRejectedValue(new Error('private platform details'));
    await expect(admitPublicRequest(event)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Request protection unavailable',
    });
  });
});
