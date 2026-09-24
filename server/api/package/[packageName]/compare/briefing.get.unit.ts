import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mockEvent } from 'h3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefingEvidence } from '#shared/briefing.defs';
import type { PackageEvidenceNamespace, PackageEvidenceObject } from '#shared/packageEvidence.defs';

import { installBriefingSchema, openBriefingD1, type BriefingD1 } from '../../../../../test/helpers/briefingD1';
import handler from './briefing.get';

let directory: string;
let runtime: BriefingD1 | undefined;

const fetchMock = vi.fn<typeof fetch>();
const idFromName = vi.fn((name: string) => ({ name }));
const objectFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const getObject = vi.fn<(id: object) => PackageEvidenceObject>(() => ({ fetch: objectFetch }));
const namespace: PackageEvidenceNamespace = { idFromName, get: getObject };

function database() {
  if (runtime === undefined) throw new Error('D1 setup failed');
  return runtime.database;
}

const evidence = (): BriefingEvidence => ({
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  sources: [
    {
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: ['https://registry.npmjs.org/minimist/1.0.0', 'https://registry.npmjs.org/minimist/2.0.0'],
      text: JSON.stringify({ changed: true, from: '>=18', to: '>=20' }),
    },
    {
      id: 'coverage',
      kind: 'coverage',
      label: 'Evidence coverage and limitations',
      urls: [],
      text: JSON.stringify({ gaps: [] }),
    },
  ],
  gaps: [],
});

const bullets = (evidenceIds: string) => ({
  bullets: [{ kind: 'change', basis: 'fact', text: 'Node requirements changed.', evidenceIds: [evidenceIds] }],
});

const providerEnvelope = (content: string) =>
  Response.json({
    id: 'chatcmpl-route-fixture',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'test-model',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  });

const providerRequests = () =>
  fetchMock.mock.calls
    .map(([input, init]) => new Request(input, init).url)
    .filter((url) => url.includes('briefing.example'));

function eventFor(
  from = '1.0.0',
  to = '2.0.0',
  packageName = 'minimist',
  binding: PackageEvidenceNamespace | undefined = namespace,
  store = database(),
) {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare/briefing?${new URLSearchParams({ from, to })}`,
  );
  event.context.params = { packageName: encodeURIComponent(packageName) };
  event.context.cloudflare = { env: { PACKAGE_EVIDENCE: binding, BRIEFINGS_DB: store } };
  return event;
}

describe('AI briefing endpoint', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'briefing-route-'));
    runtime = await openBriefingD1(directory);
  });

  beforeEach(async () => {
    await installBriefingSchema(database());
    await database().prepare('DELETE FROM package_briefings').run();
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-only-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    idFromName.mockClear();
    getObject.mockClear();
    objectFetch.mockReset().mockResolvedValue(Response.json(evidence()));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await runtime?.dispose();
    runtime = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('forwards the bounded packet to the AI pipeline and preserves the response contract', async () => {
    fetchMock.mockImplementation(async () => providerEnvelope(JSON.stringify(bullets('comparison.node'))));

    const response = await handler(eventFor());

    expect(response).toMatchObject({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: { status: 'available', model: 'test-model' },
    });
    expect(idFromName).toHaveBeenCalledWith('minimist');
    const call = objectFetch.mock.calls[0];
    if (call === undefined) throw new Error('Expected a Durable Object request');
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe('https://package-evidence/briefing-evidence');
    expect(request.method).toBe('POST');
    await expect(request.json()).resolves.toEqual({ packageName: 'minimist', from: '1.0.0', to: '2.0.0' });
    expect(providerRequests()).toHaveLength(1);
  });

  it('sanitizes backend failures as unavailable without calling AI or local collectors', async () => {
    objectFetch.mockResolvedValue(new Response('backend internals', { status: 503 }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });
    expect(providerRequests()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the request namespace binding', async () => {
    const event = eventFor();
    event.context.cloudflare = { env: { BRIEFINGS_DB: database() } };
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });
    expect(providerRequests()).toEqual([]);
  });

  it('rejects malformed route input before selecting the package object', async () => {
    await expect(handler(eventFor('', '2.0.0'))).rejects.toMatchObject({ statusCode: 400 });
    expect(idFromName).not.toHaveBeenCalled();
    expect(objectFetch).not.toHaveBeenCalled();
  });

  it('keeps D1 failure unavailable and does not spend an AI request', async () => {
    objectFetch.mockResolvedValue(Response.json(evidence()));
    const event = eventFor();
    event.context.cloudflare = { env: { PACKAGE_EVIDENCE: namespace } };

    await expect(handler(event)).resolves.toMatchObject({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: { status: 'unavailable', reason: 'cache-error', bullets: [], sources: [] },
    });
    expect(providerRequests()).toEqual([]);
  });

  it('rejects evidence for a different package instead of prompting the model', async () => {
    objectFetch.mockResolvedValue(Response.json({ ...evidence(), packageName: 'other-package' }));

    await expect(handler(eventFor())).rejects.toMatchObject({ statusCode: 503 });
    expect(providerRequests()).toEqual([]);
  });

  it('does not accept an unbounded or malformed evidence packet from the object', async () => {
    objectFetch.mockResolvedValue(
      Response.json({
        ...evidence(),
        gaps: ['x'.repeat(48 * 1024)],
      }),
    );

    await expect(handler(eventFor())).rejects.toMatchObject({ statusCode: 503 });
    expect(providerRequests()).toEqual([]);
  });
});
