import { Duration, Effect } from 'effect';
import { OtlpExporter } from 'effect/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithTelemetry } from './telemetry';
import { decodeTelemetryPayload } from './telemetry.defs';

const TELEMETRY_OPTIONS = {
  endpoint: 'http://collector.test:4318',
  serviceName: 'can-i-update-briefing',
};

const installCollector = (status = 200) => {
  const requests: Array<{ url: string; body: string }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.text() });
    return new Response(null, { status });
  });
  vi.stubGlobal('fetch', fetch);
  return requests;
};

afterEach(() => vi.unstubAllGlobals());

const findRequest = (requests: ReadonlyArray<{ url: string; body: string }>, signal: 'logs' | 'traces') => {
  const request = requests.find(({ url }) => url.endsWith(`/v1/${signal}`));
  if (request === undefined) throw new Error(`Missing ${signal} export`);
  return request;
};

const parseJson = (body: string): unknown => {
  const value: unknown = JSON.parse(body);
  return value;
};

describe('runWithTelemetry', () => {
  it('exports the ended root span and acceptance log with matching hex IDs', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const result = await runWithTelemetry(
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        const context = { traceId: span.traceId, spanId: span.spanId };
        yield* Effect.logInfo('briefing.generation.accepted').pipe(Effect.annotateLogs(context));
        return context;
      }).pipe(Effect.withSpan('briefing.generation.accepted', { root: true })),
      TELEMETRY_OPTIONS,
      (promise) => lifetime.push(promise),
    );

    await Promise.all(lifetime);
    const logs = decodeTelemetryPayload('logs', parseJson(findRequest(requests, 'logs').body));
    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const log = logs.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    const span = traces.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(log).toMatchObject({
      body: { stringValue: 'briefing.generation.accepted' },
      traceId: result.traceId,
      spanId: result.spanId,
    });
    expect(span).toMatchObject({
      name: 'briefing.generation.accepted',
      traceId: result.traceId,
      spanId: result.spanId,
    });
  });

  it('keeps scoped comparison identity on failed exports without leaking provider details', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const attributes = {
      'comparison.package.name': '@scope/package',
      'comparison.version.from': '1.0.0-beta.1',
      'comparison.version.to': '2.0.0+build.7',
      'comparison.requested.from': '^1.0.0-beta.1',
      'comparison.requested.to': 'latest',
      providerPayload: 'private-provider-detail',
      name: 'PackageEvidenceClientError',
      reason: 'upstream',
    };
    const failure = new Error('private-provider-detail');
    const program = Effect.gen(function* () {
      yield* Effect.logError('Briefing submission failed').pipe(Effect.annotateLogs(attributes));
      return yield* Effect.fail(failure);
    }).pipe(Effect.withSpan('briefing.submit', { root: true, attributes }));

    await expect(runWithTelemetry(program, TELEMETRY_OPTIONS, (promise) => lifetime.push(promise))).rejects.toBe(
      failure,
    );
    await Promise.all(lifetime);
    const logs = decodeTelemetryPayload('logs', parseJson(findRequest(requests, 'logs').body));
    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const expected = [
      { key: 'comparison.package.name', value: { stringValue: '@scope/package' } },
      { key: 'comparison.version.from', value: { stringValue: '1.0.0-beta.1' } },
      { key: 'comparison.version.to', value: { stringValue: '2.0.0+build.7' } },
      { key: 'comparison.requested.from', value: { stringValue: '^1.0.0-beta.1' } },
      { key: 'comparison.requested.to', value: { stringValue: 'latest' } },
      { key: 'name', value: { stringValue: 'PackageEvidenceClientError' } },
      { key: 'reason', value: { stringValue: 'upstream' } },
    ];
    expect(logs.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes).toEqual(expected);
    expect(traces.resourceSpans[0]?.scopeSpans[0]?.spans[0]).toMatchObject({
      attributes: expected,
      status: { code: 2 },
    });
    expect(requests.map(({ body }) => body).join('\n')).not.toContain('private-provider-detail');
  });

  it('keeps the application result when the Collector rejects telemetry', async () => {
    installCollector(503);
    const lifetime: Array<Promise<unknown>> = [];
    const result = await runWithTelemetry(
      Effect.succeed('generation persisted').pipe(Effect.withSpan('briefing.generation', { root: true })),
      TELEMETRY_OPTIONS,
      (promise) => lifetime.push(promise),
    );

    expect(result).toBe('generation persisted');
    await Promise.all(lifetime);
  });

  it('preserves an application failure while exported traces omit raw exception details', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const failure = new Error('collector-secret-provider-detail');
    const program = Effect.gen(function* () {
      yield* Effect.logError('Briefing submission failed').pipe(
        Effect.annotateLogs({ name: 'BriefingSubmissionError', reason: 'provider-error' }),
      );
      return yield* Effect.fail(failure);
    }).pipe(Effect.withSpan('briefing.generation', { root: true }));

    await expect(runWithTelemetry(program, TELEMETRY_OPTIONS, (promise) => lifetime.push(promise))).rejects.toBe(
      failure,
    );
    await Promise.all(lifetime);

    const serialized = requests.map(({ body }) => body).join('\n');
    expect(serialized).not.toContain('collector-secret-provider-detail');
    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const span = traces.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.status).toEqual({ code: 2 });
    expect(span?.events).toEqual([]);
  });

  it('keeps native exporters alive after a fully filtered span and log interval', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const result = await runWithTelemetry(
      Effect.gen(function* () {
        yield* Effect.logInfo('provider.internal.detail');
        yield* Effect.succeed(undefined).pipe(Effect.withSpan('LanguageModel.generateText'));
        yield* Effect.sleep(Duration.millis(1_100));
        const exporter = yield* OtlpExporter.Flusher;
        yield* exporter.flush;

        yield* Effect.logInfo('briefing.generation.accepted');
        yield* Effect.succeed(undefined).pipe(Effect.withSpan('briefing.generation.accepted'));
        const span = yield* Effect.currentSpan;
        return { traceId: span.traceId, spanId: span.spanId };
      }).pipe(Effect.withSpan('briefing.generation', { root: true })),
      TELEMETRY_OPTIONS,
      (promise) => lifetime.push(promise),
    );

    await Promise.all(lifetime);

    const logs = decodeTelemetryPayload('logs', parseJson(findRequest(requests, 'logs').body));
    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const exportedLog = logs.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    const exportedSpans = traces.resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    );
    expect(exportedLog?.body).toEqual({ stringValue: 'briefing.generation.accepted' });
    expect(exportedSpans.map(({ name }) => name).sort()).toEqual([
      'briefing.generation',
      'briefing.generation.accepted',
    ]);
    expect(exportedSpans.every(({ traceId }) => traceId === result.traceId)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.map(({ body }) => body).join('\n')).not.toContain('provider.internal.detail');
  });

  it('keeps approved descendants of filtered native spans sampled with their trace context', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const result = await runWithTelemetry(
      Effect.gen(function* () {
        const root = yield* Effect.currentSpan;
        const filteredParent = yield* Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          const context = { traceId: span.traceId, spanId: span.spanId };
          yield* Effect.succeed(undefined).pipe(Effect.withSpan('briefing.generation.accepted'));
          return context;
        }).pipe(Effect.withSpan('LanguageModel.generateText'));
        return { rootTraceId: root.traceId, rootSpanId: root.spanId, filteredParent };
      }).pipe(Effect.withSpan('briefing.generation', { root: true })),
      TELEMETRY_OPTIONS,
      (promise) => lifetime.push(promise),
    );

    await Promise.all(lifetime);

    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const spans = traces.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans));
    const root = spans.find(({ name }) => name === 'briefing.generation');
    const child = spans.find(({ name }) => name === 'briefing.generation.accepted');
    expect(spans.map(({ name }) => name).sort()).toEqual(['briefing.generation', 'briefing.generation.accepted']);
    expect(root).toMatchObject({ traceId: result.rootTraceId, spanId: result.rootSpanId });
    expect(result.filteredParent.traceId).toBe(result.rootTraceId);
    expect(child).toMatchObject({
      traceId: result.rootTraceId,
      parentSpanId: result.filteredParent.spanId,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).not.toContain('LanguageModel.generateText');
  });

  it('projects native response metadata before wire bounds without breaking approved trace links', async () => {
    const requests = installCollector();
    const lifetime: Array<Promise<unknown>> = [];
    const privateText = `provider-response-secret-${'x'.repeat(262_145)}`;
    const responseHeaders = Object.fromEntries(
      Array.from(
        { length: 33 },
        (_, index) => [`http.response.header.x-${index}`, `provider-header-${index}`] as const,
      ),
    );
    const failure = new Error(privateText);
    let rootContext: { traceId: string; spanId: string } | undefined;
    const program = Effect.gen(function* () {
      const root = yield* Effect.currentSpan;
      rootContext = { traceId: root.traceId, spanId: root.spanId };
      yield* Effect.succeed(undefined).pipe(
        Effect.withSpan('http.client POST', { kind: 'client', attributes: responseHeaders }),
      );
      yield* Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        span.event(privateText, BigInt(Date.now()) * 1_000_000n, { 'provider.response.payload': privateText });
      }).pipe(
        Effect.withSpan('briefing.generation.accepted', {
          attributes: responseHeaders,
          links: [{ span: root, attributes: { relationship: 'shared-generation', providerPayload: privateText } }],
        }),
      );
      return yield* Effect.fail(failure);
    }).pipe(Effect.withSpan('briefing.generation', { root: true }));

    await expect(runWithTelemetry(program, TELEMETRY_OPTIONS, (promise) => lifetime.push(promise))).rejects.toBe(
      failure,
    );
    await Promise.all(lifetime);

    const traces = decodeTelemetryPayload('traces', parseJson(findRequest(requests, 'traces').body));
    const spans = traces.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans));
    const root = spans.find(({ name }) => name === 'briefing.generation');
    const child = spans.find(({ name }) => name === 'briefing.generation.accepted');
    expect(rootContext).toBeDefined();
    expect(spans.map(({ name }) => name).sort()).toEqual(['briefing.generation', 'briefing.generation.accepted']);
    expect(root).toMatchObject({
      traceId: rootContext?.traceId,
      spanId: rootContext?.spanId,
      status: { code: 2 },
      events: [],
    });
    expect(child).toMatchObject({
      traceId: rootContext?.traceId,
      parentSpanId: rootContext?.spanId,
      attributes: [],
      links: [
        {
          traceId: rootContext?.traceId,
          spanId: rootContext?.spanId,
          attributes: [{ key: 'relationship', value: { stringValue: 'shared-generation' } }],
        },
      ],
      events: [],
    });
    expect(requests.map(({ body }) => body).join('\n')).not.toContain('provider-response-secret');
    expect(requests.map(({ body }) => body).join('\n')).not.toContain('provider-header-');
  });
});
