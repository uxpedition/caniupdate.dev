import { mockEvent } from 'h3';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvailablePackageBriefing, BriefingEvidence } from '#shared/briefing.defs';
import type { BriefingSubmission } from '#shared/briefingJob.defs';
import type { PackageEvidenceNamespace, PackageEvidenceObject } from '#shared/packageEvidence.defs';

import handler from './briefing.post';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';
const EVENTS_URL = `ws://localhost:8791/api/briefings/${HASH}/events`;

const fetchMock = vi.fn<typeof fetch>();
const idFromName = vi.fn((name: string) => ({ name }));
const objectFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const getObject = vi.fn<(id: object) => PackageEvidenceObject>(() => ({ fetch: objectFetch }));
const namespace: PackageEvidenceNamespace = { idFromName, get: getObject };
type DisposableBriefingSubmission = BriefingSubmission & { [Symbol.dispose](): void };
type BriefingService = { submit(packet: BriefingEvidence): Promise<DisposableBriefingSubmission> };

// The private binding returns Cloudflare's native disposable object.
const submit = vi.fn<(packet: BriefingEvidence) => Promise<DisposableBriefingSubmission>>();
const service: BriefingService = { submit };

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

const nativeSubmission = <T extends BriefingSubmission>(
  submission: T,
  disposer: () => void = vi.fn(),
): T & { [Symbol.dispose](): void } => Object.assign(submission, { [Symbol.dispose]: disposer });

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
const submission = ${JSON.stringify(submission)};
export class BriefingSubmitter extends WorkerEntrypoint { submit() { return submission; } }
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

describe('briefing submission endpoint', () => {
  beforeEach(() => {
    idFromName.mockClear();
    getObject.mockClear();
    objectFetch.mockReset().mockResolvedValue(Response.json(evidence()));
    submit.mockReset().mockResolvedValue(nativeSubmission(available()));
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

  it('accepts and disposes Cloudflare’s native submission object', async () => {
    const dispose = vi.fn();
    submit.mockResolvedValue(nativeSubmission(available(), dispose));

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
      expect(Object.getOwnPropertyDescriptor(raw, 'status')?.value).toBeUndefined();
      expect(raw.status).toBe('available');

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
    const response = nativeSubmission(available(), dispose);
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
    const response = nativeSubmission(available(), dispose);
    Object.defineProperty(response, 'unexpected', { value: 'application field' });
    submit.mockResolvedValue(response);

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('answers 202 with the pending envelope and the service subscription URL', async () => {
    submit.mockResolvedValue(nativeSubmission(pending()));

    const response = await handler(eventFor());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(pending());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a remote page with the socket on that page’s own host instead of the advertised loopback', async () => {
    submit.mockResolvedValue(nativeSubmission(pending()));

    const response = await handler(
      eventFor('1.0.0', '2.0.0', 'minimist', undefined, { Origin: 'http://100.122.224.20:5173' }),
    );

    const body: unknown = await response.json();
    expect(response.status).toBe(202);
    expect(body).toEqual({ ...pending(), eventsUrl: `ws://100.122.224.20:8791/api/briefings/${HASH}/events` });
  });

  it('falls back to the Host header when a submission carries no Origin', async () => {
    submit.mockResolvedValue(nativeSubmission(pending()));

    const response = await handler(eventFor('1.0.0', '2.0.0', 'minimist', undefined, { Host: '192.168.101.197:5173' }));

    const body: unknown = await response.json();
    expect(body).toMatchObject({ eventsUrl: `ws://192.168.101.197:8791/api/briefings/${HASH}/events` });
  });

  it('keeps the event path, hash, and revision a rewrite moves the host of', async () => {
    submit.mockResolvedValue(nativeSubmission(pending(7)));

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
    submit.mockResolvedValue(nativeSubmission({ ...pending(), eventsUrl: deployed }));

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
      expect(log).toHaveBeenCalledWith('Briefing submission failed', { name: 'Error' });

      log.mockClear();
      // Across the binding's RPC boundary the service's sanitized error arrives as a plain error whose name is its tag
      // and whose message is its reason.
      submit.mockRejectedValue(Object.assign(new Error('cache-error'), { name: 'BriefingSubmissionError' }));
      await expect(handler(eventFor())).rejects.toMatchObject({
        statusCode: 503,
        statusMessage: 'Briefing service unavailable',
      });
      expect(log).toHaveBeenCalledWith('Briefing submission failed', {
        name: 'BriefingSubmissionError',
        reason: 'cache-error',
      });

      log.mockClear();
      // Free text can never ride along under that name, whatever the message claims to be.
      submit.mockRejectedValue(
        Object.assign(new Error('provider body: api key sk-live-123 leaked'), { name: 'BriefingSubmissionError' }),
      );
      await expect(handler(eventFor())).rejects.toMatchObject({ statusCode: 503 });
      expect(log).toHaveBeenCalledWith('Briefing submission failed', { name: 'BriefingSubmissionError' });
    } finally {
      log.mockRestore();
    }
  });

  it('rejects an off-protocol service envelope rather than reporting a job the page cannot follow', async () => {
    // A hash the protocol does not define cannot name a job, so the route must refuse it instead of answering 202.
    submit.mockResolvedValue(nativeSubmission({ ...pending(), hash: 'job-hash' }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Briefing service unavailable',
    });
  });
});
