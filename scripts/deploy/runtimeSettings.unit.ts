import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  assertCredentialIsolation,
  PRIVATE_CI_KEYS,
  PRODUCTION_ORIGIN,
  PRODUCTION_SOCKET_ORIGIN,
  STAGE_ORIGIN,
  STAGE_SOCKET_ORIGIN,
} from './configurationKeys.ts';
import { readRuntimeSettings, RuntimeSettingsFailure } from './runtimeSettings.ts';

const validSettings = {
  NUXT_PUBLIC_SITE_URL: STAGE_ORIGIN,
  NUXT_PUBLIC_TELEMETRY_ENABLED: 'false',
  AI_BRIEFING_ENDPOINT: 'https://inference.example/v1/chat/completions',
  AI_BRIEFING_API_KEY: 'fixture-inference-key',
  AI_BRIEFING_MODEL: 'fixture-model',
  BRIEFING_PUBLIC_URL: STAGE_SOCKET_ORIGIN,
};

const checkCredentialIsolation = (environment: NodeJS.ProcessEnv) =>
  Effect.runSync(assertCredentialIsolation(environment));

const readSettings = (environment: NodeJS.ProcessEnv, target: 'stage' | 'production', releaseVersion?: string) =>
  Effect.runSync(readRuntimeSettings(environment, target, releaseVersion));

describe('GitLab private configuration boundaries', () => {
  it.each(PRIVATE_CI_KEYS)('rejects %s in the public build scope without exposing its value', (key) => {
    expect.assertions(2);
    const privateValue = 'private-fixture-marker';

    try {
      checkCredentialIsolation({ [key]: privateValue });
    } catch (cause) {
      expect(cause).toBeInstanceOf(Error);
      expect(String(cause)).not.toContain(privateValue);
    }
  });

  it.each([
    ['PUBLIC_RATE_LIMIT', 'stage'],
    ['PUBLIC_RATE_LIMIT', 'production'],
    ['BRIEFING_GENERATION_RATE_LIMIT', 'stage'],
    ['BRIEFING_GENERATION_RATE_LIMIT', 'production'],
  ] as const)('allows %s only in the %s deployment environment', (key, scope) => {
    expect(() => checkCredentialIsolation({ CI_ENVIRONMENT_NAME: scope, [key]: '90' })).not.toThrow();
    expect(() => checkCredentialIsolation({ CI_ENVIRONMENT_NAME: 'build-smoke', [key]: '90' })).toThrow(Error);
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
      readSettings({ ...validSettings, [key]: value }, 'stage');
    } catch (cause) {
      expect(cause).toBeInstanceOf(RuntimeSettingsFailure);
      expect(String(cause)).not.toContain('private-fixture-marker');
    }
  });

  it('refuses telemetry enablement that cannot reach an exporter', () => {
    expect(() => readSettings({ ...validSettings, NUXT_PUBLIC_TELEMETRY_ENABLED: 'true' }, 'stage')).toThrow(
      RuntimeSettingsFailure,
    );
  });

  it('uses the checked-in defaults when GitLab does not override rate limits', () => {
    expect(readSettings(validSettings, 'stage').rateLimits).toEqual({ public: 60, generation: 3 });
  });

  it('accepts the inclusive positive safe-integer boundaries', () => {
    const settings = readSettings(
      {
        ...validSettings,
        PUBLIC_RATE_LIMIT: '9007199254740991',
        BRIEFING_GENERATION_RATE_LIMIT: '1',
      },
      'stage',
    );

    expect(settings.rateLimits).toEqual({ public: Number.MAX_SAFE_INTEGER, generation: 1 });
  });

  it('keeps GitLab rate settings in deployment configuration, never Worker secrets or public runtime values', () => {
    const settings = readSettings(
      {
        ...validSettings,
        PUBLIC_RATE_LIMIT: '90',
        BRIEFING_GENERATION_RATE_LIMIT: '2',
      },
      'stage',
    );

    expect(settings.rateLimits).toEqual({ public: 90, generation: 2 });

    for (const workerSettings of [settings.frontend, settings.briefing, settings.evidence]) {
      expect(workerSettings).not.toHaveProperty('PUBLIC_RATE_LIMIT');
      expect(workerSettings).not.toHaveProperty('BRIEFING_GENERATION_RATE_LIMIT');
    }
  });

  it('requires production-specific origins and receipt-derived runtime release metadata', () => {
    const production = readSettings(
      {
        ...validSettings,
        NUXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN,
        BRIEFING_PUBLIC_URL: PRODUCTION_SOCKET_ORIGIN,
      },
      'production',
      '1.2.3',
    );
    const stage = readSettings(validSettings, 'stage');

    expect(production.frontend.NUXT_PUBLIC_SITE_URL).toBe(PRODUCTION_ORIGIN);
    expect(production.frontend.NUXT_PUBLIC_RELEASE_VERSION).toBe('1.2.3');
    expect(production.briefing.BRIEFING_ALLOWED_ORIGIN).toBe(PRODUCTION_ORIGIN);
    expect(stage.frontend).not.toHaveProperty('NUXT_PUBLIC_RELEASE_VERSION');
    expect(() => readSettings(validSettings, 'production', undefined)).toThrow(RuntimeSettingsFailure);
    expect(() => readSettings(validSettings, 'production', '1.2.3-rc.1')).toThrow(RuntimeSettingsFailure);
    expect(() => readSettings(validSettings, 'stage', '1.2.3')).toThrow(RuntimeSettingsFailure);
    expect(() =>
      readSettings({ ...validSettings, NUXT_PUBLIC_RELEASE_VERSION: '9.9.9' }, 'production', '1.2.3'),
    ).toThrow(RuntimeSettingsFailure);
  });

  it('allows release credentials only in their dedicated job environment', () => {
    expect(() =>
      checkCredentialIsolation({
        CI_ENVIRONMENT_NAME: 'release-tag',
        GITLAB_RELEASE_TAG_API_TOKEN: 'fixture',
        GITLAB_RELEASE_TAG_SSH_KEY: '/tmp/key',
        GITLAB_RELEASE_TAG_DEPLOY_KEY_ID: '77',
      }),
    ).not.toThrow();
    expect(() =>
      checkCredentialIsolation({ CI_ENVIRONMENT_NAME: 'production', CLOUDFLARE_API_TOKEN: 'fixture' }),
    ).not.toThrow();
    expect(() =>
      checkCredentialIsolation({ CI_ENVIRONMENT_NAME: 'stage', GITLAB_RELEASE_TAG_API_TOKEN: 'fixture' }),
    ).toThrow(Error);
    expect(() =>
      checkCredentialIsolation({ CI_ENVIRONMENT_NAME: 'production', GITLAB_RELEASE_TAG_SSH_KEY: '/tmp/key' }),
    ).toThrow(Error);
    expect(() =>
      checkCredentialIsolation({ CI_ENVIRONMENT_NAME: 'stage', NUXT_PUBLIC_RELEASE_VERSION: '1.2.3' }),
    ).toThrow(Error);
  });
});
