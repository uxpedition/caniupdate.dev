import { mockEvent } from 'h3';
import { describe, expect, it } from 'vitest';

import handler from './config.get';

const requestConfig = async (enabled?: string) => {
  const event = mockEvent('http://localhost/api/telemetry/config');
  event.context.cloudflare = {
    env: {
      ...(enabled === undefined ? {} : { NUXT_PUBLIC_TELEMETRY_ENABLED: enabled }),
      NUXT_OTEL_ENDPOINT: 'http://127.0.0.1:4318',
      NUXT_OTEL_HEADERS: '{"authorization":"Bearer private-collector-secret"}',
    },
  };

  return handler(event);
};

describe('GET /api/telemetry/config', () => {
  it('resolves post-build runtime enablement without exposing private collector settings', async () => {
    const response = await requestConfig('true');

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ enabled: true });
  });

  it('keeps telemetry disabled when no runtime opt-in is configured', async () => {
    const response = await requestConfig();

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ enabled: false });
  });
});
