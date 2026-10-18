import { getResponseHeader, mockEvent, setResponseHeader, setResponseStatus } from 'h3';
import { describe, expect, it } from 'vitest';

import { applyResponseSecurityPolicy } from './_internals/responseSecurityPolicy';

describe('response security policy', () => {
  it.each([200, 304, 400, 404, 429, 503])('protects status %i without changing its cache policy', (status) => {
    const event = mockEvent('https://example.test/');
    setResponseStatus(event, status);
    setResponseHeader(event, 'cache-control', 'no-store');

    applyResponseSecurityPolicy(event);
    applyResponseSecurityPolicy(event);

    expect(getResponseHeader(event, 'x-content-type-options')).toBe('nosniff');
    expect(getResponseHeader(event, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(getResponseHeader(event, 'cache-control')).toBe('no-store');
  });

  it.each(['no-referrer', 'same-origin', 'strict-origin'])('preserves the existing %s policy', (policy) => {
    const event = mockEvent('https://example.test/');
    setResponseHeader(event, 'referrer-policy', policy);
    setResponseHeader(event, 'x-content-type-options', 'nosniff');

    applyResponseSecurityPolicy(event);

    expect(getResponseHeader(event, 'referrer-policy')).toBe(policy);
    expect(getResponseHeader(event, 'x-content-type-options')).toBe('nosniff');
  });
});
