import { ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSmokeConfig } from './config.ts';

const localEnvironment = {
  SMOKE_LOCAL: 'true',
  SMOKE_ORIGIN: 'http://127.0.0.1:5173',
  SMOKE_SOCKET_ORIGIN: 'http://localhost:8791',
  SMOKE_EXPECTED_SHA: 'a'.repeat(40),
};

const stageEnvironment = {
  SMOKE_TARGET: 'stage',
  SMOKE_EXPECTED_SHA: 'b'.repeat(40),
  CF_ACCESS_CLIENT_ID: 'fixture-id',
  CF_ACCESS_CLIENT_SECRET: 'fixture-secret',
};

const loadConfig = (environment: Record<string, string | undefined>) =>
  readSmokeConfig.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord(environment, { preserveEmptyStrings: true }),
    ),
  );

describe('deployed smoke configuration boundaries', () => {
  it('normalizes loopback socket protocols without requiring or exposing stage credentials', async () => {
    const config = await Effect.runPromise(loadConfig(localEnvironment));
    expect(config.target).toBe('local');
    expect(config.socketOrigin.href).toBe('ws://localhost:8791/');
    expect(config.socketHttpOrigin).toBe('http://localhost:8791');
    expect(config.accessHeaders).toEqual({});
  });

  it('uses fixed stage hosts without requiring configurable origins and attaches dedicated credentials', async () => {
    const config = await Effect.runPromise(loadConfig(stageEnvironment));
    expect(config.socketOrigin.origin).toBe('wss://stage-briefing.caniupdate.dev');
    expect(config.accessHeaders).toEqual({
      'cf-access-client-id': 'fixture-id',
      'cf-access-client-secret': 'fixture-secret',
    });
  });

  it('pins production origins and requires a stable version without attaching Access credentials', async () => {
    const config = await Effect.runPromise(
      loadConfig({
        ...stageEnvironment,
        SMOKE_TARGET: 'production',
        SMOKE_EXPECTED_VERSION: '1.2.3',
        SMOKE_ORIGIN: 'https://untrusted.example',
        SMOKE_SOCKET_ORIGIN: 'wss://untrusted.example',
      }),
    );

    expect(config.target).toBe('production');
    expect(config.frontendOrigin.origin).toBe('https://caniupdate.dev');
    expect(config.socketOrigin.origin).toBe('wss://briefing.caniupdate.dev');
    expect(config.expectedVersion).toBe('1.2.3');
    expect(config.accessHeaders).toEqual({});
  });

  it.each([undefined, '', '01.2.3', '1.2.3-beta.1', '1.2.3+build'])(
    'rejects invalid production version %j',
    async (version) => {
      const failure = await Effect.runPromise(
        Effect.flip(
          loadConfig({
            SMOKE_TARGET: 'production',
            SMOKE_EXPECTED_SHA: 'a'.repeat(40),
            SMOKE_EXPECTED_VERSION: version,
          }),
        ),
      );

      expect(failure.stage).toBe('configuration');
    },
  );

  it.each([
    { SMOKE_LOCAL: '' },
    { SMOKE_LOCAL: 'yes' },
    { SMOKE_LOCAL: '1' },
    { SMOKE_TARGET: 'stage' },
    { SMOKE_ORIGIN: ' https://localhost' },
    { SMOKE_ORIGIN: 'http://user:password@localhost:5173' },
    { SMOKE_ORIGIN: 'http://localhost:5173/path' },
    { SMOKE_ORIGIN: 'http://localhost:5173/?query=yes' },
    { SMOKE_ORIGIN: 'http://localhost:5173/#fragment' },
    { SMOKE_ORIGIN: 'https://example.com' },
    { SMOKE_SOCKET_ORIGIN: 'wss://example.com' },
    { SMOKE_SOCKET_ORIGIN: 'ftp://localhost' },
    { SMOKE_EXPECTED_SHA: 'not-a-commit' },
  ])('rejects invalid local settings %j with a sanitized failure', async (overrides) => {
    const failure = await Effect.runPromise(Effect.flip(loadConfig({ ...localEnvironment, ...overrides })));
    expect(failure.stage).toBe('configuration');
    expect(failure.message).toBe('Smoke failed at configuration');
  });

  it.each([
    { SMOKE_TARGET: undefined },
    { SMOKE_TARGET: 'production' },
    { CF_ACCESS_CLIENT_ID: '' },
    { CF_ACCESS_CLIENT_SECRET: '   ' },
    { CF_ACCESS_CLIENT_SECRET: undefined },
  ])('rejects invalid stage selection and missing stage credentials %j', async (overrides) => {
    const provider = ConfigProvider.fromEnvRecord(
      { ...stageEnvironment, ...overrides },
      { preserveEmptyStrings: true },
    );

    const failure = await Effect.runPromise(
      readSmokeConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider), Effect.flip),
    );

    expect(failure.stage).toBe('configuration');
  });
});
