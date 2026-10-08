import { describe, expect, it } from 'vitest';

import { TELEMETRY_MAX_BODY_BYTES } from '../api/telemetry/_internals/ingress';
import { withTelemetryIngress } from './telemetryWorker';

describe('telemetry-aware Worker entry', () => {
  it('rejects unsupported telemetry signals before the Nitro adapter', async () => {
    let delegated = false;
    const fetch = withTelemetryIngress(async () => {
      delegated = true;
      return new Response('Nitro');
    });
    const request = new Request('http://localhost:3000/api/telemetry/v1/metrics', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: '{}',
    });

    const response = await fetch(
      request,
      { NUXT_OTEL_ENDPOINT: 'http://127.0.0.1:4318', NUXT_PUBLIC_TELEMETRY_ENABLED: 'true' },
      { waitUntil: () => undefined },
    );

    expect(response.status).toBe(404);
    expect(delegated).toBe(false);
  });

  it('rejects oversized OTLP bodies before delegating to Nitro’s buffering adapter', async () => {
    let delegated = false;
    const fetch = withTelemetryIngress(async () => {
      delegated = true;
      return new Response('Nitro');
    });
    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: 'x'.repeat(TELEMETRY_MAX_BODY_BYTES + 1),
    });

    const response = await fetch(
      request,
      { NUXT_OTEL_ENDPOINT: 'http://127.0.0.1:4318', NUXT_PUBLIC_TELEMETRY_ENABLED: 'true' },
      { waitUntil: () => undefined },
    );

    expect(response.status).toBe(413);
    expect(delegated).toBe(false);
  });
});
