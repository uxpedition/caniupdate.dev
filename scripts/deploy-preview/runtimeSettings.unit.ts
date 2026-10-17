import { describe, expect, it } from 'vitest';

import { assertCredentialIsolation, PRIVATE_CI_KEYS, STAGE_ORIGIN, STAGE_SOCKET_ORIGIN } from './configurationKeys.ts';
import { readRuntimeSettings, RuntimeSettingsFailure } from './runtimeSettings.ts';

const validSettings = {
  NUXT_PUBLIC_SITE_URL: STAGE_ORIGIN,
  NUXT_PUBLIC_TELEMETRY_ENABLED: 'false',
  AI_BRIEFING_ENDPOINT: 'https://inference.example/v1/chat/completions',
  AI_BRIEFING_API_KEY: 'fixture-inference-key',
  AI_BRIEFING_MODEL: 'fixture-model',
  BRIEFING_PUBLIC_URL: STAGE_SOCKET_ORIGIN,
};

describe('GitLab private configuration boundaries', () => {
  it.each(PRIVATE_CI_KEYS)('rejects %s in the public build scope without exposing its value', (key) => {
    expect.assertions(2);
    const privateValue = 'private-fixture-marker';

    try {
      assertCredentialIsolation({ [key]: privateValue });
    } catch (cause) {
      expect(cause).toBeInstanceOf(Error);
      expect(String(cause)).not.toContain(privateValue);
    }
  });

  it.each([
    ['AI_BRIEFING_ENDPOINT', 'https://inference.example/v1/responses'],
    ['AI_BRIEFING_ENDPOINT', 'https://inference.example/v1/chat/completions?token=private-fixture-marker'],
    ['AI_BRIEFING_ENDPOINT', 'http://inference.example/v1/chat/completions'],
    ['NUXT_PUBLIC_SITE_URL', 'https://production.example'],
    ['BRIEFING_PUBLIC_URL', 'wss://unrelated.example'],
    ['NUXT_PUBLIC_TELEMETRY_ENABLED', 'yes'],
    ['OTEL_EXPORTER_OTLP_HEADERS', '{"authorization":"private-fixture-marker","other":42}'],
    ['OTEL_EXPORTER_OTLP_HEADERS', '["private-fixture-marker"]'],
    ['PUBLIC_RATE_LIMIT', '0'],
    ['PUBLIC_RATE_LIMIT', '-1'],
    ['PUBLIC_RATE_LIMIT', '1.5'],
    ['BRIEFING_GENERATION_RATE_LIMIT', '9007199254740992'],
    ['BRIEFING_GENERATION_RATE_LIMIT', ''],
    ['PUBLIC_RATE_LIMIT', '01'],
    ['PUBLIC_RATE_LIMIT', ' 60'],
    ['BRIEFING_GENERATION_RATE_LIMIT', '1e2'],
    ['BRIEFING_GENERATION_RATE_LIMIT', '0x10'],
    ['PUBLIC_RATE_LIMIT', 'private-fixture-marker'],
    ['PUBLIC_RATE_LIMIT', undefined],
  ])('rejects invalid %s without placing private settings in diagnostics', (key, value) => {
    expect.assertions(2);

    try {
      readRuntimeSettings({ ...validSettings, [key]: value });
    } catch (cause) {
      expect(cause).toBeInstanceOf(RuntimeSettingsFailure);
      expect(String(cause)).not.toContain('private-fixture-marker');
    }
  });

  it('refuses telemetry enablement that cannot reach an exporter', () => {
    expect(() => readRuntimeSettings({ ...validSettings, NUXT_PUBLIC_TELEMETRY_ENABLED: 'true' })).toThrow(
      RuntimeSettingsFailure,
    );
  });

  it('uses the checked-in defaults when GitLab does not override rate limits', () => {
    expect(readRuntimeSettings(validSettings).rateLimits).toEqual({ public: 60, generation: 3 });
  });

  it('accepts the inclusive positive safe-integer boundaries', () => {
    const settings = readRuntimeSettings({
      ...validSettings,
      PUBLIC_RATE_LIMIT: '9007199254740991',
      BRIEFING_GENERATION_RATE_LIMIT: '1',
    });

    expect(settings.rateLimits).toEqual({ public: Number.MAX_SAFE_INTEGER, generation: 1 });
  });

  it('keeps GitLab rate settings in deployment configuration, never Worker secrets or public runtime values', () => {
    const settings = readRuntimeSettings({
      ...validSettings,
      PUBLIC_RATE_LIMIT: '90',
      BRIEFING_GENERATION_RATE_LIMIT: '2',
    });

    expect(settings.rateLimits).toEqual({ public: 90, generation: 2 });

    for (const workerSettings of [settings.frontend, settings.briefing, settings.evidence]) {
      expect(workerSettings).not.toHaveProperty('PUBLIC_RATE_LIMIT');
      expect(workerSettings).not.toHaveProperty('BRIEFING_GENERATION_RATE_LIMIT');
    }
  });
});
