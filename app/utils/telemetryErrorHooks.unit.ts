import { describe, expect, it } from 'vitest';

import { createTelemetryErrorHooks } from './telemetryErrorHooks';

describe('telemetry error hooks', () => {
  it('records sanitized Vue errors with reviewed source and frame attributes', () => {
    const records: Array<{ body: string; attributes: Record<string, string> }> = [];
    const hooks = createTelemetryErrorHooks((body, attributes) => records.push({ body, attributes }));
    const error = new TypeError('Render failed for alice@example.com at https://example.test/private');
    error.stack =
      'TypeError: Render failed\n    at render (https://app.example/_nuxt/component.abc.js?email=alice@example.com:12:4)';

    hooks['vue:error'](error);

    expect(records).toEqual([
      {
        body: 'runtime.error',
        attributes: {
          'error.source': 'vue',
          'exception.type': 'TypeError',
          'exception.message': 'Render failed for [REDACTED] at [REDACTED]',
          'exception.stacktrace': 'component.abc.js:12:4',
        },
      },
    ]);
  });

  it('does not inspect arbitrary app error objects', () => {
    const records: Array<{ body: string; attributes: Record<string, string> }> = [];
    const hooks = createTelemetryErrorHooks((body, attributes) => records.push({ body, attributes }));

    hooks['app:error']({ message: 'Bearer private-token', cause: new Error('private cause') });

    expect(records).toEqual([
      {
        body: 'runtime.error',
        attributes: { 'error.source': 'app', 'exception.type': 'Error' },
      },
    ]);
  });

  it('warns for chunk Errors and ignores non-Errors', () => {
    const records: Array<{ body: string; attributes: Record<string, string> }> = [];
    const hooks = createTelemetryErrorHooks((body, attributes) => records.push({ body, attributes }));

    const chunkError = new Error('Chunk failed');
    chunkError.stack = 'Error: Chunk failed';
    hooks['app:chunkError']({ error: chunkError });
    hooks['app:chunkError']({ error: { message: 'not an Error' } });

    expect(records).toEqual([
      {
        body: 'runtime.warning',
        attributes: {
          'error.source': 'chunk',
          'exception.type': 'Error',
          'exception.message': 'Chunk failed',
        },
      },
    ]);
  });
});
