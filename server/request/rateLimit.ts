import { createError, setResponseHeader, type H3Event } from 'h3';

import type { RateLimitCaller, RateLimitResponse } from '#shared/request/rateLimit.defs';

// One incoming platform request can trigger multiple SSR-local fetches. This memoizes admission, not counters.
const admissions = new WeakMap<Request, Promise<RateLimitCaller>>();

export const rateLimitError = (event: H3Event) => {
  setResponseHeader(event, 'Retry-After', '60');
  setResponseHeader(event, 'Cache-Control', 'no-store');

  return createError({
    statusCode: 429,
    statusMessage: 'Request limit reached. Wait about a minute, then retry.',
    data: { code: 'request-rate-limited', retryAfter: 60 } satisfies RateLimitResponse,
  });
};

const admit = async (event: H3Event): Promise<RateLimitCaller> => {
  const limiter = event.context.cloudflare?.env?.PUBLIC_RATE_LIMITER;

  if (limiter === undefined) throw createError({ statusCode: 503, statusMessage: 'Request protection unavailable' });

  // Only Nitro's original platform request is authoritative. Never read X-Forwarded-For, query/body identity,
  // or headers on an SSR-local subrequest. Cloudflare overwrites CF-Connecting-IP at public ingress.
  // Missing metadata (including Node development) shares a bucket instead of allowing caller-selected keys.
  const address = event.context.cloudflare?.request?.headers.get('cf-connecting-ip') ?? 'unidentified';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const caller = { key: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') };

  let success: boolean;

  try {
    ({ success } = await limiter.limit(caller));
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Request protection unavailable' });
  }

  if (!success) throw rateLimitError(event);

  return caller;
};

export const admitPublicRequest = async (event: H3Event): Promise<RateLimitCaller> => {
  const original = event.context.cloudflare?.request;
  let admission = original === undefined ? undefined : admissions.get(original);

  if (admission === undefined) {
    admission = admit(event);

    if (original !== undefined) admissions.set(original, admission);
  }

  const caller = await admission;
  event.context.rateLimitCaller = caller;

  return caller;
};
