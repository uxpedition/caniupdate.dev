import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';

import { openComparisonPage, runComparisonTier } from './comparisonPageTelemetry';

const installCollector = () => {
  const requests: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: await request.text() });

      return new Response(null, { status: 200 });
    }),
  );

  return {
    requests,
    telemetry: createTelemetryRuntime({ endpoint: 'http://collector.test:4318', serviceName: 'can-i-update-browser' }),
  };
};

const firstRecord = <T>(records: readonly T[]): T => {
  const record = records[0];

  if (record === undefined) throw new Error('Missing comparison page telemetry record');

  return record;
};

afterEach(() => vi.unstubAllGlobals());

describe('openComparisonPage', () => {
  it('records operation context without unresolved identity on its root span and opened log', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    const traceContext = openComparisonPage(telemetry);
    await telemetry.dispose();

    const logsRequest = requests.find(({ url }) => url.endsWith('/v1/logs'));
    const tracesRequest = requests.find(({ url }) => url.endsWith('/v1/traces'));

    if (logsRequest === undefined || tracesRequest === undefined)
      throw new Error('Expected OTLP log and trace exports');
    const logs = decodeTelemetryPayload('logs')(JSON.parse(logsRequest.body));
    const traces = decodeTelemetryPayload('traces')(JSON.parse(tracesRequest.body));
    const log = firstRecord(firstRecord(firstRecord(logs.resourceLogs).scopeLogs).logRecords);
    const span = firstRecord(firstRecord(firstRecord(traces.resourceSpans).scopeSpans).spans);

    expect(JSON.stringify({ logs, traces })).not.toMatch(
      /comparison\.package|comparison\.requested|comparison\.version/,
    );

    expect(log).toMatchObject({
      body: { stringValue: 'comparison.page.opened' },
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
    });
    expect(span).toMatchObject({
      name: 'comparison.page',
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
    });
    expect(span.attributes.map(({ key }) => key)).not.toContain('comparison.version.from');
    expect(span.attributes.map(({ key }) => key)).not.toContain('comparison.version.to');
    expect(log.attributes.map(({ key }) => key)).not.toContain('comparison.version.from');
    expect(log.attributes.map(({ key }) => key)).not.toContain('comparison.version.to');
  });
});

describe('runComparisonTier', () => {
  it('returns the original query value when diagnostic getters or classifiers throw', async () => {
    const { telemetry } = installCollector();
    const result = { packageName: 'minimist', from: '1.0.0', to: '2.0.0' };
    const load = vi.fn(async () => result);

    try {
      await expect(
        runComparisonTier('measurements', { runtime: telemetry }, new AbortController().signal, true, load, () => {
          throw new Error('PRIVATE_CLASSIFIER_MARKER');
        }),
      ).resolves.toBe(result);
      Object.defineProperty(result, 'packageName', {
        get() {
          throw new Error('PRIVATE_GETTER_MARKER');
        },
      });
      await expect(
        runComparisonTier('declarations', { runtime: telemetry }, new AbortController().signal, true, load),
      ).resolves.toBe(result);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await telemetry.dispose();
    }
  });
  it('rejects with the original load failure and records a failure, then a cancellation, outcome', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    const failure = new Error('PRIVATE_LOAD_MARKER');
    const controller = new AbortController();
    const cancelled = new Error('PRIVATE_CANCEL_MARKER');

    try {
      await expect(
        runComparisonTier('measurements', { runtime: telemetry }, new AbortController().signal, false, () =>
          Promise.reject(failure),
        ),
      ).rejects.toBe(failure);
      await expect(
        runComparisonTier('declarations', { runtime: telemetry }, controller.signal, false, () => {
          controller.abort();

          return Promise.reject(cancelled);
        }),
      ).rejects.toBe(cancelled);
    } finally {
      await telemetry.dispose();
    }

    const logsRequest = firstRecord(requests.filter(({ url }) => url.endsWith('/v1/logs')));
    const logs = decodeTelemetryPayload('logs')(JSON.parse(logsRequest.body));

    const settled = logs.resourceLogs
      .flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords))
      .filter(({ body }) => body.stringValue === 'comparison.tier.settled');

    expect(settled.map(({ attributes }) => attributes.find(({ key }) => key === 'outcome')?.value)).toEqual([
      { stringValue: 'failure' },
      { stringValue: 'cancelled' },
    ]);
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_LOAD_MARKER');
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_CANCEL_MARKER');
  });
});
