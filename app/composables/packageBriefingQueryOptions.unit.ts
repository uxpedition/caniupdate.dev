import { QueryClient } from '@tanstack/vue-query';
import type { NitroFetchRequest } from 'nitropack/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, toValue } from 'vue';

import type { AvailablePackageBriefing } from '#shared/briefing.defs';
import type { BriefingJobEvent, BriefingSubmission } from '#shared/briefingJob.defs';

import { packageBriefingQueryOptions } from './packageBriefingQueryOptions';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';
const EVENTS_URL = `ws://localhost:8791/api/briefings/${HASH}/events`;

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

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#dispatch('close');
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

// What `$fetch` rejects with when the submission route answers its sanitized 503: ofetch's FetchError exposes the
// response status under both names.
const submissionFailure = () =>
  Object.assign(new Error('[POST] "/api/package/minimist/compare/briefing": 503 Service Unavailable'), {
    status: 503,
    statusCode: 503,
  });

const runQuery = (statuses: string[], signal: AbortSignal) => {
  const { queryFn, queryKey } = packageBriefingQueryOptions(
    requestFetch,
    ref('minimist'),
    ref('1.0.0'),
    ref('2.0.0'),
    (status) => statuses.push(status),
  );
  if (typeof queryFn !== 'function') throw new Error('Expected a briefing queryFn');
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
  const rejectingFetch = <T, R extends NitroFetchRequest>(_url: R, _options?: unknown): Promise<T> =>
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

  it('resubmits once after a sanitized 503 and resolves the retried submission', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    requestFetch.mockRejectedValueOnce(submissionFailure()).mockResolvedValueOnce(pending());
    const promise = runQuery(statuses, new AbortController().signal);

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
});
