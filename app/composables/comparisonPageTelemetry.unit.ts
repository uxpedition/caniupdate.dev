import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';

import { openComparisonPage } from './comparisonPageTelemetry';

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
  it('records the package and original selectors on its root span and opened log', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    const traceContext = openComparisonPage(telemetry, '@scope/package', { from: '^1.2.0', to: 'latest' });
    await telemetry.dispose();

    const logsRequest = requests.find(({ url }) => url.endsWith('/v1/logs'));
    const tracesRequest = requests.find(({ url }) => url.endsWith('/v1/traces'));

    if (logsRequest === undefined || tracesRequest === undefined)
      throw new Error('Expected OTLP log and trace exports');
    const logs = decodeTelemetryPayload('logs', JSON.parse(logsRequest.body));
    const traces = decodeTelemetryPayload('traces', JSON.parse(tracesRequest.body));
    const log = firstRecord(firstRecord(firstRecord(logs.resourceLogs).scopeLogs).logRecords);
    const span = firstRecord(firstRecord(firstRecord(traces.resourceSpans).scopeSpans).spans);

    const expectedAttributes = [
      { key: 'comparison.package.name', value: { stringValue: '@scope/package' } },
      { key: 'comparison.requested.from', value: { stringValue: '^1.2.0' } },
      { key: 'comparison.requested.to', value: { stringValue: 'latest' } },
    ];

    expect(log).toMatchObject({
      body: { stringValue: 'comparison.page.opened' },
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
    });
    expect(log.attributes).toEqual(expect.arrayContaining(expectedAttributes));
    expect(span).toMatchObject({
      name: 'comparison.page',
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
    });
    expect(span.attributes).toEqual(expect.arrayContaining(expectedAttributes));
    expect(span.attributes.map(({ key }) => key)).not.toContain('comparison.version.from');
    expect(span.attributes.map(({ key }) => key)).not.toContain('comparison.version.to');
    expect(log.attributes.map(({ key }) => key)).not.toContain('comparison.version.from');
    expect(log.attributes.map(({ key }) => key)).not.toContain('comparison.version.to');
  });
});
