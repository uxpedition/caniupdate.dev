import { ConfigProvider, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSmokeConfig } from './config.ts';

const localEnvironment = {
  SMOKE_LOCAL: 'true',
  PREVIEW_ORIGIN: 'http://127.0.0.1:5173',
  PREVIEW_SOCKET_ORIGIN: 'http://localhost:8791',
  PREVIEW_EXPECTED_SHA: 'a'.repeat(40),
};

const stageEnvironment = {
  PREVIEW_ORIGIN: 'https://stage.caniupdate.dev',
  PREVIEW_SOCKET_ORIGIN: 'https://stage-briefing.caniupdate.dev',
  PREVIEW_EXPECTED_SHA: 'b'.repeat(40),
  CF_ACCESS_CLIENT_ID: 'fixture-id',
  CF_ACCESS_CLIENT_SECRET: 'fixture-secret',
};

const loadConfig = (environment: Record<string, string>) =>
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

  it('admits only the configured stage hosts and attaches the dedicated credentials', async () => {
    const config = await Effect.runPromise(loadConfig(stageEnvironment));
    expect(config.socketOrigin.origin).toBe('wss://stage-briefing.caniupdate.dev');
    expect(config.accessHeaders).toEqual({
      'cf-access-client-id': 'fixture-id',
      'cf-access-client-secret': 'fixture-secret',
    });
  });

  it.each([
    { SMOKE_LOCAL: '' },
    { SMOKE_LOCAL: 'yes' },
    { SMOKE_LOCAL: '1' },
    { PREVIEW_ORIGIN: ' https://localhost' },
    { PREVIEW_ORIGIN: 'http://user:password@localhost:5173' },
    { PREVIEW_ORIGIN: 'http://localhost:5173/path' },
    { PREVIEW_ORIGIN: 'http://localhost:5173/?query=yes' },
    { PREVIEW_ORIGIN: 'http://localhost:5173/#fragment' },
    { PREVIEW_ORIGIN: 'https://example.com' },
    { PREVIEW_SOCKET_ORIGIN: 'wss://example.com' },
    { PREVIEW_SOCKET_ORIGIN: 'ftp://localhost' },
    { PREVIEW_EXPECTED_SHA: 'not-a-commit' },
  ])('rejects invalid local settings %j with a sanitized failure', async (overrides) => {
    const failure = await Effect.runPromise(Effect.flip(loadConfig({ ...localEnvironment, ...overrides })));
    expect(failure.stage).toBe('configuration');
    expect(failure.message).toBe('Smoke failed at configuration');
  });

  it.each([
    { PREVIEW_ORIGIN: 'https://caniupdate.dev' },
    { PREVIEW_SOCKET_ORIGIN: 'wss://briefing.caniupdate.dev' },
    { CF_ACCESS_CLIENT_ID: '' },
    { CF_ACCESS_CLIENT_SECRET: '   ' },
    { CF_ACCESS_CLIENT_SECRET: undefined },
  ])('rejects non-stage destinations and missing stage credentials %j', async (overrides) => {
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
