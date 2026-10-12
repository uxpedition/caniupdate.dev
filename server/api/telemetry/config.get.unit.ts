import { mockEvent } from 'h3';
import { describe, expect, it } from 'vitest';

import handler from './config.get';

type ConfigFixtureEnvironment = {
  NUXT_PUBLIC_TELEMETRY_ENABLED?: string;
  NUXT_OTEL_ENDPOINT: string;
  NUXT_OTEL_HEADERS: string;
};

const requestConfig = async (enabled?: string) => {
  const event = mockEvent('http://localhost/api/telemetry/config');

  const env: ConfigFixtureEnvironment = {
    NUXT_OTEL_ENDPOINT: 'http://127.0.0.1:4318',
    NUXT_OTEL_HEADERS: '{"authorization":"Bearer private-collector-secret"}',
  };

  if (enabled !== undefined) env.NUXT_PUBLIC_TELEMETRY_ENABLED = enabled;
  event.context.cloudflare = { env };

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
