import { describe, expect, it } from 'vitest';

import { recordBrowserError, type BrowserDiagnostics } from './browserDiagnostics.ts';
import type { SmokeConfig } from './config.ts';

const config: SmokeConfig = {
  target: 'stage',
  local: false,
  frontendOrigin: new URL('https://stage.caniupdate.dev'),
  socketOrigin: new URL('wss://stage-briefing.caniupdate.dev'),
  socketHttpOrigin: 'https://stage-briefing.caniupdate.dev',
  expectedSha: 'a'.repeat(40),
  expectedVersion: null,
  accessHeaders: { 'cf-access-client-id': 'fixture-access-id', 'cf-access-client-secret': 'fixture-access-secret' },
};

const emptyDiagnostics = (): BrowserDiagnostics => ({ total: 0, entries: [] });

describe('browser failure diagnostics', () => {
  it('retains actionable console and uncaught error details in the report', () => {
    const diagnostics = emptyDiagnostics();
    recordBrowserError(diagnostics, config, {
      kind: 'console-error',
      message: 'Failed to load resource: the server responded with a status of 404',
      source: 'https://stage.caniupdate.dev/_nuxt/comparison.js?token=private#fragment',
      line: 12,
      column: 4,
    });
    recordBrowserError(diagnostics, config, {
      kind: 'page-error',
      message: "TypeError: Cannot read properties of undefined (reading 'status')",
    });

    expect(diagnostics).toEqual({
      total: 2,
      entries: [
        {
          kind: 'console-error',
          message: 'Failed to load resource: the server responded with a status of 404',
          source: 'https://stage.caniupdate.dev/_nuxt/comparison.js',
          line: 12,
          column: 4,
        },
        { kind: 'page-error', message: "TypeError: Cannot read properties of undefined (reading 'status')" },
      ],
    });
  });

  it('redacts credentials, private URLs, structured payloads, and control characters before export', () => {
    const diagnostics = emptyDiagnostics();
    recordBrowserError(diagnostics, config, {
      kind: 'console-error',
      message:
        'Request failed fixture-access-secret fixture-access-id ' +
        'https://user:password@private-provider.invalid/v1/chat?key=secret ' +
        'Authorization: Bearer unknown-token api_key=another-token ' +
        'person@example.invalid\n\u001b[31m {"prompt":"private prompt","evidence":"private evidence"}',
      source: 'https://private-provider.invalid/private/path?key=secret',
    });

    const exported = JSON.stringify(diagnostics);

    for (const value of [
      'fixture-access-secret',
      'fixture-access-id',
      'private-provider',
      'unknown-token',
      'another-token',
      'person@example',
      'private prompt',
      'private evidence',
      '\\u001b',
    ]) {
      expect(exported).not.toContain(value);
    }

    expect(diagnostics.entries[0]?.message).toContain('Request failed');
    expect(diagnostics.entries[0]?.source).toBe('[external-url]');
  });

  it('bounds stored errors and message size without losing the failure count', () => {
    const diagnostics = emptyDiagnostics();

    for (let index = 0; index < 25; index += 1) {
      recordBrowserError(diagnostics, config, { kind: 'page-error', message: 'error '.repeat(250) });
    }

    expect(diagnostics.total).toBe(25);
    expect(diagnostics.entries).toHaveLength(20);
    expect(diagnostics.entries.every((entry) => entry.message.length <= 1000)).toBe(true);
  });

  it('removes credential values before truncation even when they cross the message boundary', () => {
    const diagnostics = emptyDiagnostics();
    recordBrowserError(diagnostics, config, {
      kind: 'page-error',
      message: `${'x '.repeat(495)}fixture-access-secret`,
      source: `https://stage.caniupdate.dev/${'a.'.repeat(480)}fixture-access-secret`,
    });

    expect(diagnostics.entries[0]?.message).toContain('[redacted]');
    expect(JSON.stringify(diagnostics)).not.toContain('fixture-ac');
  });
});
