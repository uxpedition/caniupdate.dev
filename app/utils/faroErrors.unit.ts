import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';

import { initializeFaroErrors } from './faroErrors';

type WindowHandler = EventListenerOrEventListenerObject;

type WindowStub = {
  listeners: Map<string, Set<WindowHandler>>;
  onerror: OnErrorEventHandler;
  addEventListener(type: string, listener: WindowHandler): void;
  removeEventListener(type: string, listener: WindowHandler): void;
};

const makeBrowserWindow = (): WindowStub => {
  const listeners = new Map<string, Set<WindowHandler>>();

  return {
    listeners,
    onerror: null,
    addEventListener(type: string, listener: WindowHandler) {
      const current = listeners.get(type) ?? new Set<WindowHandler>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: WindowHandler) {
      listeners.get(type)?.delete(listener);
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

type BoundCapture = ReturnType<typeof initializeFaroErrors>;

type CapturedRequest = { readonly url: string; readonly body: string };

const arrangeCapture = (requests: CapturedRequest[], browserWindow: WindowStub): BoundCapture => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: await request.text() });

      return new Response(null, { status: 200 });
    }),
  );
  vi.stubGlobal('window', browserWindow);

  const capture = initializeFaroErrors();
  expect(initializeFaroErrors()).toBe(capture);
  expect(browserWindow.listeners.get('unhandledrejection')?.size).toBe(1);

  capture.captureError(new Error('oldest queued exception'));

  for (let index = 0; index < 31; index++) capture.captureError(new Error(`queued exception ${index}`));

  return capture;
};

const expectDedupedVueFailure = (capture: BoundCapture): void => {
  const failure = new TypeError(
    'Render failed for alice@example.com; api_key=fixture-secret; https://user:password@example.org/view?token=third-secret',
  );

  expect(capture.captureError(failure, { source: 'vue', fatal: true })).toBe(true);
  expect(capture.captureError(failure, { source: 'vue', fatal: true })).toBe(true);
};

const flushExports = async (capture: BoundCapture): Promise<void> => {
  const telemetry = createTelemetryRuntime({
    endpoint: 'http://collector.test:4318',
    serviceName: 'can-i-update-browser',
  });

  await telemetry.context();
  capture.attachRuntime(telemetry);
  await telemetry.dispose();
  capture.stop();
  expect(capture.captureError(new Error('capture after teardown'))).toBe(false);
};

const rejectionEvent = (reason: string): Event => {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });

  return event;
};

describe('Faro error integration', () => {
  it('reuses page capture, deduplicates Error objects, bounds queued logs, and exports sanitized diagnostics', async () => {
    const requests: Array<CapturedRequest> = [];
    const browserWindow = makeBrowserWindow();
    const capture = arrangeCapture(requests, browserWindow);
    expectDedupedVueFailure(capture);

    const rejectionListener = browserWindow.listeners.get('unhandledrejection')?.values().next().value;

    // oxlint-disable-next-line rules/no-runtime-typeof -- Discriminating the declared EventListenerOrEventListenerObject union to require the callable arm.
    if (typeof rejectionListener !== 'function') throw new Error('Expected Faro rejection instrumentation');
    rejectionListener(rejectionEvent('api_key=primitive-secret'));

    await flushExports(capture);

    const logsRequest = requests.find(({ url }) => url.endsWith('/v1/logs'));

    if (logsRequest === undefined) throw new Error('Expected an OTLP log export');
    const logs = decodeTelemetryPayload('logs')(JSON.parse(logsRequest.body));
    const records = logs.resourceLogs.flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords));
    const serialized = JSON.stringify(logs);

    const failureRecords = records.filter(({ attributes }) =>
      attributes.some(({ key, value }) => key === 'exception.message' && value.stringValue.includes('Render failed')),
    );

    const failureRecord = failureRecords[0];

    expect(records).toHaveLength(32);
    expect(failureRecords).toHaveLength(1);

    const rejectionRecords = records.filter(({ attributes }) =>
      attributes.some(({ key, value }) => key === 'error.source' && value.stringValue === 'browser.rejection'),
    );

    expect(rejectionRecords).toHaveLength(1);
    expect(rejectionRecords[0]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'exception.type', value: { stringValue: 'Error' } },
        { key: 'error.source', value: { stringValue: 'browser.rejection' } },
      ]),
    );
    expect(rejectionRecords[0]?.attributes.find(({ key }) => key === 'exception.message')?.value.stringValue).toContain(
      'Non-Error promise rejection captured with value: [REDACTED]',
    );
    expect(records.every(({ body }) => body.stringValue === 'runtime.error')).toBe(true);
    expect(
      records
        .map(({ attributes }) => attributes)
        .flat()
        .some(({ value }) => value.stringValue.includes('oldest queued')),
    ).toBe(false);
    expect(failureRecord?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'exception.type', value: { stringValue: 'TypeError' } },
        { key: 'error.source', value: { stringValue: 'vue' } },
      ]),
    );
    expect(failureRecord?.attributes.find(({ key }) => key === 'exception.message')?.value.stringValue).toContain(
      '[REDACTED]',
    );
    expect(serialized).not.toMatch(
      /alice@example\.com|fixture-secret|third-secret|user:password|example\.org|primitive-secret/,
    );
    expect(serialized).not.toContain('fatal');
  });
});
