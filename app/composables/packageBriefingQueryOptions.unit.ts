import { QueryClient } from '@tanstack/vue-query';
import { Predicate, Schema } from 'effect';
import type { NitroFetchRequest } from 'nitropack/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, toValue } from 'vue';

import type { AvailablePackageBriefing } from '#shared/comparison/briefing/briefing.defs';
import type { BriefingJobEvent, BriefingSubmission } from '#shared/comparison/briefing/briefingJob.defs';
import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';
import { parseTraceparent } from '#shared/telemetry/traceContext.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

import { packageBriefingQueryOptions } from './packageBriefingQueryOptions';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';

const EVENTS_URL = `ws://localhost:8791/api/briefings/${HASH}/events`;

const PAGE_CONTEXT = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' } satisfies TraceContext;

const briefing = (): AvailablePackageBriefing => ({
  status: 'available',
  model: 'test-model',
  bullets: [{ kind: 'change', basis: 'fact', text: 'Node requirements changed.', evidenceNumbers: [1] }],
  sources: [
    {
      number: 1,
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: ['https://registry.npmjs.org/minimist/1.0.0', 'https://registry.npmjs.org/minimist/2.0.0'],
      text: JSON.stringify({ changed: true, from: '>=18', to: '>=20' }),
    },
  ],
});

const available = (): BriefingSubmission => ({
  status: 'available',
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  briefing: briefing(),
});

const pending = (revision = 3): BriefingSubmission => ({
  status: 'queued',
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  hash: HASH,
  eventsUrl: EVENTS_URL,
  revision,
});

type SocketListener = (event: { data?: unknown }) => void;

type SocketEvent = 'message' | 'close';

/** The one socket a submission may open, with the service's own reconnect behavior simulated. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  closeCalls = 0;
  #listeners: Record<SocketEvent, SocketListener[]> = { message: [], close: [] };

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.instances.push(this);
  }

  addEventListener(type: SocketEvent, listener: SocketListener): void {
    this.#listeners[type].push(listener);
  }

  removeEventListener(type: SocketEvent, listener: SocketListener): void {
    this.#listeners[type] = this.#listeners[type].filter((candidate) => candidate !== listener);
  }

  close(): void {
    this.closeCalls += 1;

    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#dispatch('close');
  }

  open(): void {
    this.readyState = 1;
  }

  /** The current snapshot the service sends on every connect, the first one included. */
  snapshot(frame: BriefingJobEvent): void {
    this.readyState = 1;
    this.#dispatch('message', JSON.stringify(frame));
  }

  /** A frame the page must not try to read. */
  rawSnapshot(data: string): void {
    this.readyState = 1;
    this.#dispatch('message', data);
  }

  /** A transient disconnect: the browser reports a close with no terminal frame. */
  drop(): void {
    this.readyState = 3;
    this.#dispatch('close');
  }

  #dispatch(type: SocketEvent, data?: string): void {
    for (const listener of this.#listeners[type]) listener({ data });
  }
}

const requestFetch = vi.fn();

const queryClient = new QueryClient();

const installTelemetryCollector = () => {
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

const isScalarString = Schema.is(Schema.String);

const traceparentAt = (index: number): string | undefined => {
  const options: unknown = requestFetch.mock.calls[index]?.[1];

  if (!Predicate.isObjectOrArray(options) || !('headers' in options)) return undefined;
  const headers = options.headers;

  if (!Predicate.isObjectOrArray(headers) || !('traceparent' in headers)) return undefined;

  return isScalarString(headers.traceparent) ? headers.traceparent : undefined;
};

// What `$fetch` rejects with when the submission route answers its sanitized 503: ofetch's FetchError exposes the
// response status under both names.
const submissionFailure = () =>
  Object.assign(new Error('[POST] "/api/package/minimist/compare/briefing": 503 Service Unavailable'), {
    status: 503,
    statusCode: 503,
  });

type RunQueryOptions = {
  readonly telemetryRuntime?: TelemetryRuntime;
  readonly packageName?: string;
  readonly from?: string;
  readonly to?: string;
};

const runQuery = (
  statuses: string[],
  signal: AbortSignal,
  pageContext?: TraceContext,
  options: RunQueryOptions = {},
) => {
  const { queryFn, queryKey } = packageBriefingQueryOptions(
    requestFetch,
    ref(options.packageName ?? 'minimist'),
    ref(options.from ?? '1.0.0'),
    ref(options.to ?? '2.0.0'),
    (status) => statuses.push(status),
    pageContext,
    options.telemetryRuntime,
  );

  if (!Predicate.isFunction(queryFn)) throw new Error('Expected a briefing queryFn');

  return queryFn({ client: queryClient, queryKey: toValue(queryKey), signal, meta: undefined });
};

const startQuery = (submission: BriefingSubmission, statuses: string[], signal: AbortSignal) => {
  requestFetch.mockResolvedValue(submission);

  return runQuery(statuses, signal);
};

const waitForSocket = async (index: number) => {
  await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(index));
  const socket = FakeSocket.instances[index];

  if (socket === undefined) throw new Error(`Expected socket ${index + 1} to be open`);

  return socket;
};

describe('packageBriefingQueryOptions', () => {
  const rejectingFetch = <T, R extends NitroFetchRequest>(_url: R): Promise<T> =>
    Promise.reject(new Error('not called'));

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    requestFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses a separate key for the briefing endpoint with normalized versions', () => {
    const options = packageBriefingQueryOptions(rejectingFetch, ref(' react '), ref(' 19.0.0 '), ref(' 19.3.0 '));

    expect(toValue(options.queryKey)).toEqual(['npm', 'packages', 'briefing', 'react', '19.0.0', '19.3.0']);
    expect(toValue(options.enabled)).toBe(false);
  });

  it('submits exactly once, without retries, and renders an available result without a socket', async () => {
    const statuses: string[] = [];
    const response = await startQuery(available(), statuses, new AbortController().signal);

    expect(response).toEqual(available());
    expect(requestFetch).toHaveBeenCalledTimes(1);
    expect(requestFetch).toHaveBeenCalledWith(
      '/api/package/minimist/compare/briefing',
      expect.objectContaining({ method: 'POST', query: { from: '1.0.0', to: '2.0.0' }, retry: false }),
    );
    expect(FakeSocket.instances).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it('sends a client traceparent directly beneath the route context', async () => {
    requestFetch.mockResolvedValue(available());

    await runQuery([], new AbortController().signal, PAGE_CONTEXT);

    const clientContext = parseTraceparent(traceparentAt(0));
    expect(clientContext).toMatchObject({ traceId: PAGE_CONTEXT.traceId });
    expect(clientContext?.spanId).not.toBe(PAGE_CONTEXT.spanId);
  });

  it('records resolved query identity on a failed submit span and its start log', async () => {
    const { requests, telemetry } = installTelemetryCollector();
    await telemetry.context();
    const failure = new Error('[POST] "/api/package/%40scope%2Fpackage/compare/briefing": 500 private-provider-detail');
    requestFetch.mockRejectedValueOnce(failure);
    const options = { telemetryRuntime: telemetry, packageName: '@scope/package', from: '1.2.3', to: '2.0.0-beta.1' };

    await expect(runQuery([], new AbortController().signal, PAGE_CONTEXT, options)).rejects.toBe(failure);
    expect(requestFetch).toHaveBeenCalledTimes(1);
    expect(requestFetch).toHaveBeenCalledWith(
      '/api/package/%40scope%2Fpackage/compare/briefing',
      expect.objectContaining({ query: { from: '1.2.3', to: '2.0.0-beta.1' } }),
    );
    await telemetry.dispose();

    const logsRequest = requests.find(({ url }) => url.endsWith('/v1/logs'));
    const tracesRequest = requests.find(({ url }) => url.endsWith('/v1/traces'));

    if (logsRequest === undefined || tracesRequest === undefined)
      throw new Error('Expected OTLP log and trace exports');
    const logs = decodeTelemetryPayload('logs')(JSON.parse(logsRequest.body));
    const traces = decodeTelemetryPayload('traces')(JSON.parse(tracesRequest.body));
    const log = logs.resourceLogs.flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords))[0];
    const span = traces.resourceSpans.flatMap(({ scopeSpans }) => scopeSpans.flatMap(({ spans }) => spans))[0];

    const expectedAttributes = [
      { key: 'comparison.package.name', value: { stringValue: '@scope/package' } },
      { key: 'comparison.version.from', value: { stringValue: '1.2.3' } },
      { key: 'comparison.version.to', value: { stringValue: '2.0.0-beta.1' } },
    ];

    expect(log).toMatchObject({ body: { stringValue: 'briefing.submission.started' }, spanId: span?.spanId });
    expect(log?.attributes).toEqual(expect.arrayContaining(expectedAttributes));
    expect(span).toMatchObject({
      name: 'briefing.submit',
      traceId: PAGE_CONTEXT.traceId,
      parentSpanId: PAGE_CONTEXT.spanId,
      status: { code: 2 },
    });
    expect(span?.attributes).toEqual(expect.arrayContaining(expectedAttributes));
    expect(span?.attributes.map(({ key }) => key)).not.toContain('comparison.requested.to');
    const exported = requests.map(({ body }) => body).join('\n');
    expect(exported).not.toContain('/api/package/');
    expect(exported).not.toContain('private-provider-detail');
  });

  it.each(['upstream returned plain text', 42])(
    'surfaces a primitive rejection %j unchanged after one attempt, without resubmitting',
    async (rejection) => {
      requestFetch.mockRejectedValueOnce(rejection);

      await expect(runQuery([], new AbortController().signal, PAGE_CONTEXT)).rejects.toBe(rejection);
      expect(requestFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('resubmits once after a sanitized 503 and resolves the retried submission', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    requestFetch.mockRejectedValueOnce(submissionFailure()).mockResolvedValueOnce(pending());
    const promise = runQuery(statuses, new AbortController().signal, PAGE_CONTEXT);

    expect(requestFetch).toHaveBeenCalledTimes(1);
    // The resubmission waits, so nothing is retried yet and no socket exists.
    expect(FakeSocket.instances).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(requestFetch).toHaveBeenCalledTimes(2);
    // The resubmission is the same POST: same route, same versions, same no-retry options.
    const post = { method: 'POST', query: { from: '1.0.0', to: '2.0.0' }, retry: false };
    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      '/api/package/minimist/compare/briefing',
      expect.objectContaining(post),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      '/api/package/minimist/compare/briefing',
      expect.objectContaining(post),
    );
    const firstContext = parseTraceparent(traceparentAt(0));
    const secondContext = parseTraceparent(traceparentAt(1));
    expect(firstContext).toMatchObject({ traceId: PAGE_CONTEXT.traceId });
    expect(secondContext).toMatchObject({ traceId: PAGE_CONTEXT.traceId });
    expect(firstContext?.spanId).not.toBe(secondContext?.spanId);

    const socket = await waitForSocket(0);
    expect(socket.url).toBe(EVENTS_URL);
    socket.snapshot({ status: 'available', revision: 5, briefing: briefing() });

    await expect(promise).resolves.toEqual({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: briefing(),
    });
    expect(requestFetch).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['queued']);
  });

  it('never resubmits a 200 available or a 202 pending submission', async () => {
    vi.useFakeTimers();
    await expect(startQuery(available(), [], new AbortController().signal)).resolves.toEqual(available());
    expect(requestFetch).toHaveBeenCalledTimes(1);

    requestFetch.mockReset();
    const promise = startQuery(pending(), [], new AbortController().signal);
    const socket = await waitForSocket(0);
    socket.snapshot({ status: 'available', revision: 5, briefing: briefing() });
    await expect(promise).resolves.toMatchObject({ briefing: { status: 'available' } });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the sanitized failure when the resubmission fails too, without a third attempt', async () => {
    vi.useFakeTimers();
    const first = submissionFailure();
    const second = submissionFailure();
    requestFetch.mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    const promise = runQuery([], new AbortController().signal);
    const rejection = expect(promise).rejects.toBe(second);

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(requestFetch).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toEqual([]);
  });

  it('does not resubmit when the query is aborted during the pause', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    requestFetch.mockRejectedValueOnce(submissionFailure());
    const promise = runQuery([], controller.signal);

    await vi.advanceTimersByTimeAsync(100);
    expect(requestFetch).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('follows the submission socket, publishes queued and running, and completes on the available frame', async () => {
    const statuses: string[] = [];
    const promise = startQuery(pending(), statuses, new AbortController().signal);

    const socket = await waitForSocket(0);
    expect(socket.url).toBe(EVENTS_URL);

    socket.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued', 'running']);
    socket.snapshot({ status: 'available', revision: 5, briefing: briefing() });

    await expect(promise).resolves.toEqual({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: briefing(),
    });
    expect(socket.closeCalls).toBe(1);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores frames at or below the highest revision it has already seen', async () => {
    const statuses: string[] = [];
    const promise = startQuery(pending(3), statuses, new AbortController().signal);

    const socket = await waitForSocket(0);
    socket.snapshot({ status: 'running', revision: 2 });
    expect(statuses).toEqual(['queued']);
    socket.snapshot({ status: 'running', revision: 3 });
    expect(statuses).toEqual(['queued']);
    socket.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued', 'running']);
    socket.snapshot({ status: 'available', revision: 5, briefing: briefing() });

    await expect(promise).resolves.toMatchObject({ briefing: { status: 'available' } });
  });

  it('resolves an unavailable terminal frame so the page keeps its factual rows', async () => {
    const promise = startQuery(pending(), [], new AbortController().signal);

    const socket = await waitForSocket(0);
    socket.snapshot({ status: 'unavailable', revision: 4, reason: 'provider-error' });

    await expect(promise).resolves.toEqual({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: { status: 'unavailable', reason: 'provider-error', bullets: [], sources: [] },
    });
    expect(socket.closeCalls).toBe(1);
  });

  it('reconnects from the current snapshot without submitting again', async () => {
    const statuses: string[] = [];
    const promise = startQuery(pending(), statuses, new AbortController().signal);

    vi.useFakeTimers();
    const first = await waitForSocket(0);
    first.drop();
    await vi.advanceTimersByTimeAsync(1_000);

    const second = await waitForSocket(1);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(second.url).toBe(EVENTS_URL);
    second.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued', 'running']);
    second.snapshot({ status: 'available', revision: 5, briefing: briefing() });

    await expect(promise).resolves.toMatchObject({ briefing: { status: 'available' } });
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a pre-aborted subscription with its reason without opening a socket', async () => {
    const reason = new Error('cancelled before subscription');
    const controller = new AbortController();
    controller.abort(reason);

    await expect(startQuery(pending(), [], controller.signal)).rejects.toBe(reason);
    expect(FakeSocket.instances).toEqual([]);
  });

  it('closes a connected socket that never sends a frame by the deadline', async () => {
    const promise = Promise.resolve(startQuery(pending(), [], new AbortController().signal));
    vi.useFakeTimers();
    let subscriptionError: unknown;
    void promise.catch((error) => {
      subscriptionError = error;
    });

    const socket = await waitForSocket(0);
    socket.open();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(String(subscriptionError)).toContain('The briefing subscription exceeded its 180-second deadline');
    expect(socket.closeCalls).toBe(1);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps one 180-second deadline across reconnects and progress frames', async () => {
    const statuses: string[] = [];
    const promise = Promise.resolve(startQuery(pending(), statuses, new AbortController().signal));
    vi.useFakeTimers();
    let subscriptionError: unknown;
    void promise.catch((error) => {
      subscriptionError = error;
    });

    const first = await waitForSocket(0);
    first.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = await waitForSocket(1);
    await vi.advanceTimersByTimeAsync(168_999);

    second.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued', 'running']);
    await vi.advanceTimersByTimeAsync(11_000);

    expect(String(subscriptionError)).toContain('The briefing subscription exceeded its 180-second deadline');
    expect(second.closeCalls).toBe(1);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores frames from a socket after it disconnects', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const promise = startQuery(pending(), statuses, new AbortController().signal);
    const first = await waitForSocket(0);
    first.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = await waitForSocket(1);

    first.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued']);
    second.snapshot({ status: 'running', revision: 4 });
    expect(statuses).toEqual(['queued', 'running']);
    second.snapshot({ status: 'available', revision: 5, briefing: briefing() });

    await expect(promise).resolves.toMatchObject({ briefing: { status: 'available' } });
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after cancellation during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = startQuery(pending(), [], controller.signal);
    const first = await waitForSocket(0);
    first.drop();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('stops after three reconnects, one second, two, then four, and never resubmits', async () => {
    const promise = startQuery(pending(), [], new AbortController().signal);

    vi.useFakeTimers();
    const first = await waitForSocket(0);

    first.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1]?.drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(3);

    FakeSocket.instances[2]?.drop();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(FakeSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(4);

    FakeSocket.instances[3]?.drop();
    await expect(promise).rejects.toThrow('The briefing stream closed before it reported a result');
    expect(requestFetch).toHaveBeenCalledTimes(1);
  });

  it('closes the socket and stops when the query is aborted', async () => {
    const controller = new AbortController();
    const promise = startQuery(pending(), [], controller.signal);

    const socket = await waitForSocket(0);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket.closeCalls).toBe(1);
    socket.drop();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('fails the query on a frame the protocol does not define instead of waiting forever', async () => {
    const promise = startQuery(pending(), [], new AbortController().signal);

    const socket = await waitForSocket(0);
    socket.rawSnapshot('{"status":"available","revision":4,"packet":{"apiKey":"leak"}}');

    await expect(promise).rejects.toThrow('The briefing stream sent a frame the page cannot read');
    expect(socket.closeCalls).toBe(1);
  });

  it('calls onStatus for every status frame but records each subscription transition once', async () => {
    const { requests, telemetry } = installTelemetryCollector();
    await telemetry.context();
    const statuses: string[] = [];
    requestFetch.mockResolvedValue(pending());
    const promise = runQuery(statuses, new AbortController().signal, undefined, { telemetryRuntime: telemetry });

    const socket = await waitForSocket(0);
    socket.snapshot({ status: 'running', revision: 4 });
    socket.snapshot({ status: 'running', revision: 5 });
    socket.snapshot({ status: 'available', revision: 6, briefing: briefing() });

    await expect(promise).resolves.toMatchObject({ briefing: { status: 'available' } });
    await telemetry.dispose();

    expect(statuses).toEqual(['queued', 'running', 'running']);
    expect(requestFetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);

    const logsRequest = requests.find(({ url }) => url.endsWith('/v1/logs'));

    if (logsRequest === undefined) throw new Error('Expected OTLP log export');

    const logs = decodeTelemetryPayload('logs')(JSON.parse(logsRequest.body));

    const outcomes = logs.resourceLogs
      .flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords))
      .filter(({ body }) => body.stringValue === 'briefing.subscription.transition')
      .map(({ attributes }) => attributes.find(({ key }) => key === 'outcome')?.value);

    expect(outcomes).toEqual([{ stringValue: 'queued' }, { stringValue: 'running' }, { stringValue: 'available' }]);
  });

  it('leaves status callbacks and the resolved briefing unchanged when the subscription reporter throws', async () => {
    const { telemetry } = installTelemetryCollector();
    await telemetry.context();

    const reporterSpy = vi.spyOn(telemetry, 'runSync').mockImplementation(() => {
      throw new Error('PRIVATE_REPORTER_MARKER');
    });

    const statuses: string[] = [];
    requestFetch.mockResolvedValue(pending());

    try {
      const promise = runQuery(statuses, new AbortController().signal, undefined, { telemetryRuntime: telemetry });
      const socket = await waitForSocket(0);
      socket.snapshot({ status: 'running', revision: 4 });
      socket.snapshot({ status: 'available', revision: 5, briefing: briefing() });

      await expect(promise).resolves.toEqual({
        packageName: 'minimist',
        from: '1.0.0',
        to: '2.0.0',
        briefing: briefing(),
      });
      expect(statuses).toEqual(['queued', 'running']);
      expect(reporterSpy).toHaveBeenCalled();
    } finally {
      await telemetry.dispose();
    }
  });
});
