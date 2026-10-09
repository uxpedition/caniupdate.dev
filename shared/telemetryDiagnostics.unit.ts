import { createError, mockEvent } from 'h3';
import { describe, expect, it, vi } from 'vitest';

import {
  createServerDiagnosticSend,
  isServerDiagnosticReportable,
  reportServerDiagnostic,
} from './telemetryDiagnostics';

describe('server diagnostics privacy and outcomes', () => {
  it('exports reviewed error fields with scrubbed prose through one send per owned error', async () => {
    const sends: Array<{ body: string; attributes: Record<string, string>; waitUntil?: unknown }> = [];
    const send = vi.fn(async (body: string, attributes: Record<string, string>) => {
      sends.push({ body, attributes });
    });

    const event = mockEvent('/package/react/2.0.0..2.5.0', { method: 'GET' });
    const failure = new TypeError('SSR failed for gina@example.com Authorization: Bearer fixture-secret');
    failure.stack = 'TypeError: SSR failed\n    at file:///worker/server/render.vue:14:3';

    await reportServerDiagnostic(event, { send, body: 'runtime.error', source: 'nuxt.ssr', error: failure });
    await reportServerDiagnostic(event, { send, body: 'runtime.error', source: 'nuxt.ssr', error: failure });
    const sameEventDifferentFailure = new Error('Second local failure');
    await reportServerDiagnostic(event, {
      send,
      body: 'runtime.error',
      source: 'nuxt.ssr',
      error: sameEventDifferentFailure,
    });

    expect(sends).toHaveLength(2);
    expect(sends[0]?.attributes).toEqual({
      'error.source': 'nuxt.ssr',
      'exception.type': 'TypeError',
      'exception.message': 'SSR failed for [REDACTED] [REDACTED]',
      'exception.stacktrace': 'render.vue:14:3',
    });
    // Object-identity dedupe only: a similar message from a fresh object is its own diagnostic.
    expect(sends[1]?.attributes['exception.message']).toBe('Second local failure');
  });

  it('keeps expected outcomes and ingress recursion out of diagnostics', async () => {
    const send = vi.fn(async () => undefined);

    const blockedRoutes = ['/api/telemetry/v1/logs', '/api/telemetry/config'];
    for (const path of blockedRoutes) {
      const recursionEvent = mockEvent(path, { method: 'POST' });
      expect(isServerDiagnosticReportable(recursionEvent, new Error('recursion'), undefined)).toBe(false);
    }
    const opaqueRequest = mockEvent('/package/react/2.0.0..2.5.0', { method: 'GET' });
    expect(isServerDiagnosticReportable(opaqueRequest, undefined, 404)).toBe(false);
    expect(isServerDiagnosticReportable(opaqueRequest, new Error('missing'), 429)).toBe(false);
    expect(isServerDiagnosticReportable(opaqueRequest, undefined, undefined)).toBe(true);
    const aborted = Object.assign(new Error('client walked away'), { name: 'AbortError' });
    expect(isServerDiagnosticReportable(opaqueRequest, aborted, 500)).toBe(false);
    expect(isServerDiagnosticReportable(opaqueRequest, new Error('render leak'), 500)).toBe(true);
    const h3Failure = createError({ statusCode: 500, statusMessage: 'worker blew the stack' });
    expect(isServerDiagnosticReportable(opaqueRequest, h3Failure, h3Failure.statusCode)).toBe(true);

    const event = mockEvent('/package/react/2.0.0..2.5.0', { method: 'GET' });
    await reportServerDiagnostic(event, {
      send,
      body: 'runtime.error',
      source: 'nuxt',
      error: createError({ statusCode: 404 }),
      status: 404,
    });
    await reportServerDiagnostic(event, { send, body: 'runtime.error', source: 'nuxt', error: aborted, status: 500 });
    await reportServerDiagnostic(event, { send, body: 'runtime.error', source: 'nuxt', error: undefined });
    expect(send).not.toHaveBeenCalled();
  });

  it('creates a disabled-off runtime send that never disturbs request handling', async () => {
    const fallbackSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const noneEvent = mockEvent('/package/react/2.0.0..2.5.0', { method: 'GET' });
    const noneSend = createServerDiagnosticSend(noneEvent, { enabled: false, endpoint: '', headers: {} });
    await expect(noneSend('runtime.error', { 'error.source': 'nuxt' })).resolves.toBeUndefined();
    expect(fallbackSpy).not.toHaveBeenCalled();

    const configEvent = mockEvent('/package/react/2.0.0..2.5.0', { method: 'GET' });
    const configSend = createServerDiagnosticSend(configEvent, {
      enabled: true,
      endpoint: 'http://127.0.0.1:1.invalid/v1',
      headers: {},
    });
    await expect(configSend('runtime.error', { 'error.source': 'nuxt' })).resolves.toBeUndefined();
    expect(fallbackSpy).not.toHaveBeenCalled();
    fallbackSpy.mockRestore();
  });
});
