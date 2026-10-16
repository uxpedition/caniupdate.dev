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
});
