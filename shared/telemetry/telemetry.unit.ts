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

const decodeLogExport = (body: string) => {
  const value: unknown = JSON.parse(body);

  return decodeTelemetryPayload('logs')(value);
};

const decodeTraceExport = (body: string) => {
  const value: unknown = JSON.parse(body);

  return decodeTelemetryPayload('traces')(value);
};

describe('runWithTelemetry', () => {
  it.each([undefined, 200, 503])('protects console and export with sink status %s', async (status) => {
    const requests = status === undefined ? [] : installCollector(status);
    const consoleLines: string[] = [];

    const methods = ['log', 'info', 'warn', 'error', 'debug'] satisfies Array<
      'log' | 'info' | 'warn' | 'error' | 'debug'
    >;

    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((value: string) => {
        consoleLines.push(value);
      }),
    );

    const attributes = {
      'comparison.package.name': '@sindresorhus/is',
      'comparison.version.from': '1.0.0',
      'comparison.version.to': '2.0.0',
      'comparison.requested.to': 'REJECTED_SELECTOR_MARKER',
      'exception.message': 'RAW_PROSE_MARKER',
      headers: { authorization: 'NESTED_SECRET_MARKER' },
      payload: { evidence: 'PRIVATE_EVIDENCE_MARKER' },
      reason: 'timeout',
    };

    try {
      const result = await runWithTelemetry(
        Effect.gen(function* () {
          yield* Effect.logWarning('runtime.warning').pipe(Effect.annotateLogs(attributes));
          yield* Effect.logWarning('runtime.warning', new Error('RAW_CAUSE_MARKER')).pipe(
            Effect.annotateLogs(attributes),
          );
          yield* Effect.logInfo('UNAPPROVED_MESSAGE_MARKER');

          return 'unchanged';
        }),
        status === undefined ? { serviceName: 'can-i-update-briefing' } : TELEMETRY_OPTIONS,
      );

      expect(result).toBe('unchanged');
      const output = [...consoleLines, ...requests.map(({ body }) => body)].join('\n');
      expect(consoleLines.join('\n')).toContain('@sindresorhus/is');
      expect(output).not.toMatch(
        /REJECTED_SELECTOR_MARKER|RAW_PROSE_MARKER|NESTED_SECRET_MARKER|PRIVATE_EVIDENCE_MARKER|RAW_CAUSE_MARKER|UNAPPROVED_MESSAGE_MARKER/,
      );
      expect(attributes.headers.authorization).toBe('NESTED_SECRET_MARKER');
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
  it('does not inspect raw failure prose while ending native spans', async () => {
    installCollector();
    let reads = 0;
    const failure = new Error('PRIVATE_FAILURE_MARKER');
    Object.defineProperty(failure, 'message', {
      get() {
        reads += 1;

        return 'PRIVATE_FAILURE_MARKER';
      },
    });
    await expect(
      runWithTelemetry(Effect.fail(failure).pipe(Effect.withSpan('briefing.generation')), TELEMETRY_OPTIONS),
    ).rejects.toBe(failure);
    expect(reads).toBe(0);
  });

  it('does not inspect unknown link payload prose before native conversion', async () => {
    const requests = installCollector();
    let reads = 0;

    const privateDetail = {
      get privateMessage() {
        reads += 1;

        return 'PRIVATE_LINK_MARKER';
      },
    };

    const result = await runWithTelemetry(
      Effect.gen(function* () {
        const root = yield* Effect.currentSpan;

        return yield* Effect.succeed('unchanged').pipe(
          Effect.withSpan('evidence.collection', {
            root: true,
            links: [{ span: root, attributes: { relationship: 'shared-collection', privateDetail } }],
          }),
        );
      }).pipe(Effect.withSpan('comparison.measurements')),
      TELEMETRY_OPTIONS,
    );

    expect(result).toBe('unchanged');
    expect(reads).toBe(0);
    expect(requests.map(({ body }) => body).join('\n')).not.toContain('PRIVATE_LINK_MARKER');
  });

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
    const logs = decodeLogExport(findRequest(requests, 'logs').body);
    const traces = decodeTraceExport(findRequest(requests, 'traces').body);
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
    const logs = decodeLogExport(findRequest(requests, 'logs').body);
    const traces = decodeTraceExport(findRequest(requests, 'traces').body);

    const expected = [
      { key: 'comparison.package.name', value: { stringValue: '@scope/package' } },
      { key: 'comparison.version.from', value: { stringValue: '1.0.0-beta.1' } },
      { key: 'comparison.version.to', value: { stringValue: '2.0.0+build.7' } },
      { key: 'name', value: { stringValue: 'PackageEvidenceClientError' } },
      { key: 'reason', value: { stringValue: 'upstream' } },
    ];

    expect(logs.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes).toEqual(expect.arrayContaining(expected));
    expect(traces.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes).toEqual(expect.arrayContaining(expected));
    expect(traces.resourceSpans[0]?.scopeSpans[0]?.spans[0]).toMatchObject({ status: { code: 2 } });
    const exported = requests.map(({ body }) => body).join('\n');
    expect(exported).not.toContain('private-provider-detail');
    expect(exported).not.toContain('comparison.requested.');
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
    const traces = decodeTraceExport(findRequest(requests, 'traces').body);
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

    const logs = decodeLogExport(findRequest(requests, 'logs').body);
    const traces = decodeTraceExport(findRequest(requests, 'traces').body);
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

    const traces = decodeTraceExport(findRequest(requests, 'traces').body);
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

    const traces = decodeTraceExport(findRequest(requests, 'traces').body);
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
