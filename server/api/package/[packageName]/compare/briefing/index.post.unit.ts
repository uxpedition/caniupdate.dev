import { Schema } from 'effect';
import { mockEvent } from 'h3';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { AvailablePackageBriefing, BriefingEvidence } from '#shared/comparison/briefing/briefing.defs';
import type { BriefingSubmission } from '#shared/comparison/briefing/briefingJob.defs';
import type { BriefingServiceResult } from '#shared/comparison/briefing/briefingService.defs';
import type { StoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';
import type {
  PackageEvidenceNamespace,
  PackageEvidenceObject,
  PackageEvidenceObjectId,
} from '#shared/comparison/evidence/packageEvidence.defs';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';

import readHandler from './index.get';
import handler from './index.post';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';

const EVENTS_URL = `ws://localhost:8791/api/briefings/${HASH}/events`;

const fetchMock = vi.fn<typeof fetch>();

const idFromName = vi.fn((name: string) => ({ name }));

const objectFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const getObject = vi.fn<(id: PackageEvidenceObjectId) => PackageEvidenceObject>(() => ({ fetch: objectFetch }));

const namespace: PackageEvidenceNamespace = { idFromName, get: getObject };

type DisposableBriefingServiceResult = BriefingServiceResult & { [Symbol.dispose](): void };

type DisposableStoredBriefingResult = StoredBriefingResult & { [Symbol.dispose](): void };

type BriefingService = {
  submit(packet: BriefingEvidence): Promise<DisposableBriefingServiceResult>;
  read(packet: BriefingEvidence): Promise<DisposableStoredBriefingResult>;
};

// The private binding returns Cloudflare's native disposable objects.
const submit = vi.fn<(packet: BriefingEvidence) => Promise<DisposableBriefingServiceResult>>();

const read = vi.fn<(packet: BriefingEvidence) => Promise<DisposableStoredBriefingResult>>();

const service: BriefingService = { submit, read };

const evidence = (): BriefingEvidence => ({
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
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
  gaps: [],
});

const briefing = (): AvailablePackageBriefing => ({
  status: 'available',
  model: 'test-model',
  bullets: [{ kind: 'change', basis: 'fact', text: 'Node requirements changed.', evidenceNumbers: [1] }],
  sources: evidence().sources,
});

const available = () =>
  ({
    status: 'available',
    packageName: 'minimist',
    from: '1.0.0',
    to: '2.0.0',
    briefing: briefing(),
  }) as const;

const pending = (revision = 3) =>
  ({
    status: 'queued',
    packageName: 'minimist',
    from: '1.0.0',
    to: '2.0.0',
    hash: HASH,
    eventsUrl: EVENTS_URL,
    revision,
  }) as const;

const nativeServiceResult = (
  submission: BriefingSubmission,
  disposer: () => void = vi.fn(),
  generationContext?: TraceContext,
): DisposableBriefingServiceResult =>
  Object.assign(generationContext === undefined ? { submission } : { submission, generationContext }, {
    [Symbol.dispose]: disposer,
  });

const nativeStoredResult = (
  result: StoredBriefingResult,
  disposer: () => void = vi.fn(),
): DisposableStoredBriefingResult => Object.assign(result, { [Symbol.dispose]: disposer });

const nodeBridgeService = async (submission: BriefingSubmission) => {
  const serviceName = 'briefing-node-rpc-service';
  const callerName = 'briefing-node-rpc-caller';

  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: serviceName,
          compatibilityDate: '2026-09-16',
          compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2'],
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: `import { WorkerEntrypoint } from 'cloudflare:workers';
const result = { submission: ${JSON.stringify(submission)} };
export class BriefingSubmitter extends WorkerEntrypoint { submit() { return result; } }
export default { fetch() { return new Response('ok'); } };`,
              },
            },
          },
        },
      },
      {
        config: {
          name: callerName,
          compatibilityDate: '2026-09-16',
          compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2'],
          env: { BRIEFING_SERVICE: { type: 'worker', worker: serviceName, exportName: 'BriefingSubmitter' } },
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: "export default { fetch() { return new Response('ok'); } };" },
            },
          },
        },
      },
    ],
  });

  try {
    const bindings = await runtime.getBindings<{ BRIEFING_SERVICE: BriefingService }>(callerName);

    return { service: bindings.BRIEFING_SERVICE, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};

function eventFor(
  from = '1.0.0',
  to = '2.0.0',
  packageName = 'minimist',
  env: { PACKAGE_EVIDENCE?: PackageEvidenceNamespace; BRIEFING_SERVICE?: BriefingService } = {
    PACKAGE_EVIDENCE: namespace,
    BRIEFING_SERVICE: service,
  },
  headers: Record<string, string> = {},
) {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare/briefing?${new URLSearchParams({ from, to })}`,
    { headers },
  );

  event.context.params = { packageName: encodeURIComponent(packageName) };
  event.context.cloudflare = { env };

  return event;
}

const ConsoleLogRecordSchema = Schema.Struct({ annotations: Schema.Record(Schema.String, Schema.Unknown) });

type ConsoleLogRecord = typeof ConsoleLogRecordSchema.Type;

const isScalarString = Schema.is(Schema.String);

const decodeConsoleLogRecord = Schema.decodeUnknownSync(ConsoleLogRecordSchema, { errors: 'all' });

// Console spies record each argument as unknown; the first argument of a call is narrowed to a string here, at capture.
const loggedLine = (log: MockInstance, call = 0): string => {
  const value: unknown = log.mock.calls[call]?.[0];

  if (!isScalarString(value)) throw new Error('Expected a JSON console record');

  return value;
};

const annotationsFromLog = (line: string): ConsoleLogRecord['annotations'] => {
  let record: unknown;

  try {
    record = JSON.parse(line);
  } catch {
    throw new Error('Expected a valid JSON console record');
  }

  try {
    return decodeConsoleLogRecord(record).annotations;
  } catch {
    throw new Error('Expected annotations in the console record');
  }
};

describe('briefing submission endpoint', () => {
  beforeEach(() => {
    idFromName.mockClear();
    getObject.mockClear();
    objectFetch.mockReset().mockResolvedValue(Response.json(evidence()));
    submit.mockReset().mockResolvedValue(nativeServiceResult(available()));
    read
      .mockReset()
      .mockResolvedValue(
        nativeStoredResult({ status: 'missing', packageName: 'minimist', from: '1.0.0', to: '2.0.0' }),
      );
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the bounded packet to the private service and answers 200 with the available envelope', async () => {
    const response = await handler(eventFor());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(available());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(evidence());
    // The route owns no provider call and no store: the packet's only destination is the private binding.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(idFromName).toHaveBeenCalledWith('minimist');
    const call = objectFetch.mock.calls[0];

    if (call === undefined) throw new Error('Expected a Durable Object request');
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe('https://package-evidence/briefing-evidence');
    expect(request.method).toBe('POST');
    await expect(request.json()).resolves.toEqual({ packageName: 'minimist', from: '1.0.0', to: '2.0.0' });
  });

  describe('read-only stored-result endpoint', () => {
    it('returns an explicit miss and never submits a generation', async () => {
      const response = await readHandler(eventFor());

      expect(response).toEqual({
        status: 'missing',
        packageName: 'minimist',
        from: '1.0.0',
        to: '2.0.0',
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(evidence());
      expect(submit).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a strictly decoded success and disposes the native RPC result', async () => {
      const disposer = vi.fn();
      const result = available();
      read.mockResolvedValue(nativeStoredResult(result, disposer));

      const response = await readHandler(eventFor());

      expect(response).toEqual(available());
      expect(disposer).toHaveBeenCalledTimes(1);
      expect(submit).not.toHaveBeenCalled();
    });

    it('keeps storage and evidence failures distinct from a miss', async () => {
      read.mockRejectedValue(Object.assign(new Error('private database detail'), { name: 'BriefingSubmissionError' }));
      await expect(readHandler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Briefing service unavailable',
      });
      expect(submit).not.toHaveBeenCalled();

      read.mockReset();
      objectFetch.mockRejectedValue(new Error('private evidence detail'));
      await expect(readHandler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Evidence service unavailable',
      });
      expect(read).not.toHaveBeenCalled();
    });

    it('refuses a result whose identity differs from the evidence packet', async () => {
      read.mockResolvedValue(
        nativeStoredResult({ status: 'missing', packageName: 'other', from: '1.0.0', to: '2.0.0' }),
      );

      await expect(readHandler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Briefing service unavailable',
      });
      expect(submit).not.toHaveBeenCalled();
    });
  });

  it('logs requested selectors separately from the resolved packet identity', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const resolved = { ...evidence(), from: '1.4.0', to: '3.0.0' };
    objectFetch.mockResolvedValue(Response.json(resolved));
    submit.mockResolvedValue(nativeServiceResult({ ...available(), from: resolved.from, to: resolved.to }));

    try {
      const response = await handler(eventFor('^1.0.0', 'latest'));

      expect(response.status).toBe(200);
      expect(submit).toHaveBeenCalledWith(resolved);
      expect(annotationsFromLog(loggedLine(log))).toMatchObject({
        'comparison.package.name': 'minimist',
        'comparison.version.from': '1.4.0',
        'comparison.version.to': '3.0.0',
      });
      expect(loggedLine(log)).not.toMatch(/\^1\.0\.0|latest/);
    } finally {
      log.mockRestore();
    }
  });

  it('creates a distinct server child span for each valid incoming client context and links the shared generation', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const generationContext: TraceContext = {
      traceId: '9f4f7c51d7339f60cae8f53609e7b9d2',
      spanId: '4a2bf8ebd98a0123',
    };

    submit.mockResolvedValue(nativeServiceResult(pending(), undefined, generationContext));
    objectFetch.mockImplementation(async () => Response.json(evidence()));

    try {
      const first = await handler(
        eventFor('1.0.0', '2.0.0', 'minimist', undefined, {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
        }),
      );

      const second = await handler(
        eventFor('1.0.0', '2.0.0', 'minimist', undefined, {
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00',
        }),
      );

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      await expect(first.json()).resolves.toEqual(pending());
      await expect(second.json()).resolves.toEqual(pending());
      expect(log).toHaveBeenCalledTimes(2);
      const firstAnnotations = annotationsFromLog(loggedLine(log));
      const secondAnnotations = annotationsFromLog(loggedLine(log, 1));
      expect(firstAnnotations).toMatchObject({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentSpanId: '00f067aa0ba902b7',
        linkedTraceId: generationContext.traceId,
        linkedSpanId: generationContext.spanId,
      });
      expect(secondAnnotations).toMatchObject({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        parentSpanId: 'b7ad6b7169203331',
        linkedTraceId: generationContext.traceId,
        linkedSpanId: generationContext.spanId,
      });
      expect(firstAnnotations.spanId).not.toBe(secondAnnotations.spanId);
    } finally {
      log.mockRestore();
    }
  });

  it('starts a fresh server trace when the incoming traceparent is malformed', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const response = await handler(eventFor('1.0.0', '2.0.0', 'minimist', undefined, { traceparent: '00-invalid' }));

      expect(response.status).toBe(200);
      expect(log).toHaveBeenCalledTimes(1);
      const annotations = annotationsFromLog(loggedLine(log));
      expect(annotations.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(annotations.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(annotations.parentSpanId).toBeUndefined();
      expect(annotations.linkedTraceId).toBeUndefined();
      expect(annotations.linkedSpanId).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });

  it('accepts and disposes Cloudflare’s native submission object', async () => {
    const dispose = vi.fn();
    submit.mockResolvedValue(nativeServiceResult(available(), dispose));

    const response = await handler(eventFor());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(available());
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('accepts a real Miniflare Node development RPC result', async () => {
    const bridge = await nodeBridgeService(available());

    try {
      // Node's Miniflare proxy deliberately hides symbols and omits descriptor values; property access is still live.
      const raw = await bridge.service.submit(evidence());
      expect(raw[Symbol.dispose]).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(raw, 'submission')?.value).toBeUndefined();
      expect(raw.submission).toEqual(available());

      const result = await handler(
        eventFor('1.0.0', '2.0.0', 'minimist', {
          PACKAGE_EVIDENCE: namespace,
          BRIEFING_SERVICE: bridge.service,
        }),
      );

      expect(result.status).toBe(200);
      await expect(result.json()).resolves.toEqual(available());
    } finally {
      await bridge.dispose();
    }
  });

  it('rejects a foreign RPC symbol while disposing the documented one', async () => {
    const dispose = vi.fn();
    const response = nativeServiceResult(available(), dispose);
    Object.defineProperty(response, Symbol('foreign-rpc-symbol'), { value: () => undefined });
    submit.mockResolvedValue(response);

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-enumerable application field while disposing the RPC object', async () => {
    const dispose = vi.fn();
    const response = nativeServiceResult(available(), dispose);
    Object.defineProperty(response, 'unexpected', { value: 'application field' });
    submit.mockResolvedValue(response);

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('answers 202 with the pending envelope and the service subscription URL', async () => {
    submit.mockResolvedValue(nativeServiceResult(pending()));

    const response = await handler(eventFor());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(pending());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a remote page with the socket on that page’s own host instead of the advertised loopback', async () => {
    submit.mockResolvedValue(nativeServiceResult(pending()));

    const response = await handler(
      eventFor('1.0.0', '2.0.0', 'minimist', undefined, { Origin: 'http://100.122.224.20:5173' }),
    );

    const body: unknown = await response.json();
    expect(response.status).toBe(202);
    expect(body).toEqual({ ...pending(), eventsUrl: `ws://100.122.224.20:8791/api/briefings/${HASH}/events` });
  });

  it('falls back to the Host header when a submission carries no Origin', async () => {
    submit.mockResolvedValue(nativeServiceResult(pending()));

    const response = await handler(eventFor('1.0.0', '2.0.0', 'minimist', undefined, { Host: '192.168.101.197:5173' }));

    const body: unknown = await response.json();
    expect(body).toMatchObject({ eventsUrl: `ws://192.168.101.197:8791/api/briefings/${HASH}/events` });
  });

  it('keeps the event path, hash, and revision a rewrite moves the host of', async () => {
    submit.mockResolvedValue(nativeServiceResult(pending(7)));

    const response = await handler(
      eventFor('1.0.0', '2.0.0', 'minimist', undefined, { Origin: 'http://100.122.224.20:5173' }),
    );

    // Only the host moves: the hash-addressed path, the job hash, and the frame revision are the service's own values.
    await expect(response.json()).resolves.toEqual({
      ...pending(7),
      eventsUrl: `ws://100.122.224.20:8791/api/briefings/${HASH}/events`,
    });
  });

  it('leaves the deployed service’s own hostname alone', async () => {
    const deployed = `wss://can-i-update-preview-briefing.caniupdate-dev.workers.dev/api/briefings/${HASH}/events`;
    submit.mockResolvedValue(nativeServiceResult({ ...pending(), eventsUrl: deployed }));

    const response = await handler(
      eventFor('1.0.0', '2.0.0', 'minimist', undefined, {
        Origin: 'https://can-i-update-preview.caniupdate-dev.workers.dev',
      }),
    );

    const body: unknown = await response.json();
    expect(body).toMatchObject({ eventsUrl: deployed });
  });

  it('rejects malformed route input before selecting the package object', async () => {
    await expect(handler(eventFor('', '2.0.0'))).rejects.toMatchObject({ statusCode: 400 });

    expect(idFromName).not.toHaveBeenCalled();
    expect(objectFetch).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('reports a missing evidence binding as a sanitized 503 without submitting', async () => {
    await expect(handler(eventFor('1.0.0', '2.0.0', 'minimist', { BRIEFING_SERVICE: service }))).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });

    expect(submit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing briefing service binding as a sanitized 503 instead of a fictitious job', async () => {
    await expect(
      handler(eventFor('1.0.0', '2.0.0', 'minimist', { PACKAGE_EVIDENCE: namespace })),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });

    expect(submit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs no comparison identity when evidence fails before a resolved packet exists', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    objectFetch.mockResolvedValue(new Response('private evidence details', { status: 503 }));

    try {
      await expect(handler(eventFor('https://private.example/?token=secret', 'latest'))).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Evidence service unavailable',
      });

      expect(log).toHaveBeenCalledTimes(1);
      const line = loggedLine(log);
      expect(annotationsFromLog(line)).toMatchObject({ name: 'PackageEvidenceClientError', reason: 'upstream' });
      expect(annotationsFromLog(line)).not.toHaveProperty('comparison.package.name');
      expect(line).not.toMatch(/latest/);
      expect(line).not.toContain('private.example');
      expect(line).not.toContain('token=secret');
      expect(submit).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('sanitizes an evidence-service failure without submitting or spending an AI request', async () => {
    objectFetch.mockResolvedValue(new Response('backend internals', { status: 503 }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });

    expect(submit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses evidence for a different package instead of submitting it', async () => {
    objectFetch.mockResolvedValue(Response.json({ ...evidence(), packageName: 'other-package' }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses an evidence response over the shared byte bound instead of submitting it', async () => {
    // The body carries no content-length, so the bound is the streaming one the client enforces while it reads.
    objectFetch.mockResolvedValue(Response.json({ ...evidence(), gaps: ['x'.repeat(48 * 1024)] }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it('sanitizes a private service rejection instead of leaking it', async () => {
    submit.mockRejectedValue(new Error('BRIEFING_SERVICE internals: provider credential rejected'));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
  });

  it('logs only the error name and the service reason while answering the same opaque 503', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // This test submits three times, and a Response body can only be read once.
      objectFetch.mockImplementation(async () => Response.json(evidence()));
      submit.mockRejectedValue(new Error('BRIEFING_SERVICE internals: provider credential rejected'));
      await expect(handler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Briefing service unavailable',
      });
      // A foreign failure contributes its name and nothing else: no message, no provider text, no credential.
      expect(log).toHaveBeenCalledTimes(1);
      expect(annotationsFromLog(loggedLine(log))).toMatchObject({
        name: 'Error',
        'comparison.package.name': 'minimist',
        'comparison.version.from': '1.0.0',
        'comparison.version.to': '2.0.0',
      });
      expect(String(log.mock.calls[0]?.[0])).not.toContain('provider credential rejected');

      log.mockClear();
      // Across the binding's RPC boundary the service's sanitized error arrives as a plain error whose name is its tag
      // and whose message is its reason.
      submit.mockRejectedValue(Object.assign(new Error('cache-error'), { name: 'BriefingSubmissionError' }));
      await expect(handler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Briefing service unavailable',
      });
      expect(annotationsFromLog(loggedLine(log))).toMatchObject({
        name: 'BriefingSubmissionError',
        reason: 'cache-error',
      });

      log.mockClear();
      // Free text can never ride along under that name, whatever the message claims to be.
      submit.mockRejectedValue(
        Object.assign(new Error('provider body: api key sk-live-123 leaked'), { name: 'BriefingSubmissionError' }),
      );
      await expect(handler(eventFor())).rejects.toMatchObject({ statusCode: 503 });
      expect(annotationsFromLog(loggedLine(log))).toMatchObject({ name: 'BriefingSubmissionError' });
      expect(String(log.mock.calls[0]?.[0])).not.toContain('sk-live-123');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects an off-protocol service envelope rather than reporting a job the page cannot follow', async () => {
    // A hash the protocol does not define cannot name a job, so the route must refuse it instead of answering 202.
    submit.mockResolvedValue(nativeServiceResult({ ...pending(), hash: 'job-hash' }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
  });
});
