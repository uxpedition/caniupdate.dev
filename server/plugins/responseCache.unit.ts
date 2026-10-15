import { getResponseHeader, mockEvent, setResponseHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { describe, expect, it } from 'vitest';

import { applyResponseCachePolicy } from './_internals/responseCachePolicy';

const htmlResponse = (url: string, method = 'GET', statusCode = 200): H3Event => {
  const event = mockEvent(url, { method });
  setResponseStatus(event, statusCode);
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');

  return event;
};

describe('response cache policy', () => {
  it('sets a one-year homepage edge TTL while requiring browser revalidation', () => {
    const event = htmlResponse('https://caniupdate.dev/?source=test');

    applyResponseCachePolicy(event);

    expect(getResponseHeader(event, 'cache-control')).toBe('no-cache');
    expect(getResponseHeader(event, 'cloudflare-cdn-cache-control')).toBe('public, max-age=31536000, must-revalidate');
  });

  it('sets a one-year privacy edge TTL while requiring browser revalidation', () => {
    const event = htmlResponse('https://caniupdate.dev/privacy');

    applyResponseCachePolicy(event);

    expect(getResponseHeader(event, 'cache-control')).toBe('no-cache');
    expect(getResponseHeader(event, 'cloudflare-cdn-cache-control')).toBe('public, max-age=31536000, must-revalidate');
  });

  it('sets a one-year about page edge TTL while requiring browser revalidation', () => {
    const event = htmlResponse('https://caniupdate.dev/about');

    applyResponseCachePolicy(event);

    expect(getResponseHeader(event, 'cache-control')).toBe('no-cache');
    expect(getResponseHeader(event, 'cloudflare-cdn-cache-control')).toBe('public, max-age=31536000, must-revalidate');
  });

  it('caches only a completed comparison HTML response for twelve hours', () => {
    const event = htmlResponse('https://caniupdate.dev/minimist/compare?from=1.0.0&to=2.0.0');
    event.context.comparisonHtmlCacheable = true;

    applyResponseCachePolicy(event);

    expect(getResponseHeader(event, 'cache-control')).toBe('no-cache');
    expect(getResponseHeader(event, 'cloudflare-cdn-cache-control')).toBe('public, max-age=43200, must-revalidate');
  });

  it('opts out all other dynamic, failed, non-HTML, and non-GET responses', () => {
    const unmarkedComparison = htmlResponse('https://caniupdate.dev/minimist/compare');
    const missingRoute = htmlResponse('https://caniupdate.dev/not-a-page');
    const failedHomepage = htmlResponse('https://caniupdate.dev/', 'GET', 503);
    const postHomepage = htmlResponse('https://caniupdate.dev/', 'POST');
    const nonHtml = mockEvent('https://caniupdate.dev/api/health');
    setResponseStatus(nonHtml, 200);
    setResponseHeader(nonHtml, 'content-type', 'application/json');

    for (const event of [unmarkedComparison, missingRoute, failedHomepage, postHomepage, nonHtml]) {
      applyResponseCachePolicy(event);

      expect(getResponseHeader(event, 'cache-control')).toBe('no-store');
      expect(getResponseHeader(event, 'cloudflare-cdn-cache-control')).toBe('no-store');
    }
  });
});
