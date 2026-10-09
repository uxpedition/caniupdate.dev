import { describe, expect, it } from 'vitest';

import { decodeTelemetryRuntimeConfig } from './telemetryConfig.defs';

describe('decodeTelemetryRuntimeConfig', () => {
  it('accepts only the runtime enablement flag', () => {
    expect(decodeTelemetryRuntimeConfig({ enabled: true })).toEqual({ enabled: true });
    expect(() => decodeTelemetryRuntimeConfig({ enabled: true, endpoint: 'http://collector.example' })).toThrow();
    expect(() => decodeTelemetryRuntimeConfig({ enabled: true, headers: { authorization: 'secret' } })).toThrow();
  });

  it('rejects non-boolean enablement values', () => {
    expect(() => decodeTelemetryRuntimeConfig({ enabled: 'true' })).toThrow();
  });
});
