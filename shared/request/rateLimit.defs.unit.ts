import { describe, expect, it } from 'vitest';

import { decodeRateLimitCaller, rateLimitMessage } from './rateLimit.defs';

describe('rate limit boundary contracts', () => {
  it('distinguishes generation allowance from public request protection without rendering raw error prose', () => {
    const refusal = (code: string) =>
      Object.assign(new Error('private-provider-marker'), {
        data: { statusCode: 429, data: { code, retryAfter: 60 } },
      });

    expect(rateLimitMessage(refusal('generation-rate-limited'))).toContain('Too many new AI briefings');
    expect(rateLimitMessage(refusal('request-rate-limited'))).toContain('Too many requests');
    expect(rateLimitMessage(refusal('private-provider-marker'))).toBeUndefined();
    expect(
      rateLimitMessage({ statusCode: 503, data: { code: 'generation-rate-limited', retryAfter: 60 } }),
    ).toBeUndefined();
  });

  it('rejects missing, arbitrary or extra identity fields at private RPC boundaries', () => {
    for (const caller of [undefined, { key: 'spoofed' }, { key: 'a'.repeat(64), ip: '192.0.2.1' }]) {
      expect(() => decodeRateLimitCaller(caller)).toThrow();
    }
  });
});
