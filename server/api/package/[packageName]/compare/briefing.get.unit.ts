import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mockEvent } from 'h3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBriefingSchema, openBriefingD1, type BriefingD1 } from '../../../../../test/helpers/briefingD1';
import type endpointHandler from './briefing.get';

let handler: typeof endpointHandler;
let directory: string;
let runtime: BriefingD1 | undefined;

const registry = { json: vi.fn<(path: string) => Promise<unknown>>() };

const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

// Miniflare startup dominates this suite, so every test shares one runtime and an explicitly emptied table.
function database() {
  if (runtime === undefined) throw new Error('D1 setup failed');
  return runtime.database;
}

const fetchMock = vi.fn<typeof fetch>();

const providerRequests = () =>
  fetchMock.mock.calls
    .map(([input, init]) => new Request(input, init).url)
    .filter((url) => url.includes('briefing.example'));

function eventFor(from: string, to: string, packageName = 'minimist') {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare/briefing?${new URLSearchParams({ from, to })}`,
  );
  event.context.params = { packageName: encodeURIComponent(packageName) };
  event.context.cloudflare = { env: { BRIEFINGS_DB: database() } };
  return event;
}

function startRequest(from: string, to: string, packageName = 'minimist') {
  return Promise.resolve(handler(eventFor(from, to, packageName)));
}

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
    // A static import cannot drop module-level Effect caches, so each test reloads the boundary explicitly.
    vi.resetModules();
    handler = (await import('./briefing.get')).default;
    registry.json.mockReset();
    fetchMock.mockReset();
    // Evidence providers (tarballs, OSV, Bundlephobia, GitHub) answer as unavailable unless a test overrides them;
    // the registry manifests below never reach this stub.
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(new Request(input, init).url);
      // Registry manifests come from the fixture; tarballs share that host and stay with the fetching stub.
      if (url.origin === 'https://registry.npmjs.org' && !url.pathname.includes('/-/')) {
        return Response.json(await registry.json(url.pathname));
      }
      return fetchMock(input, init);
    });
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

  it('returns a cited briefing for the resolved pair', async () => {
    registry.json.mockImplementation(async (path) => {
      const old = path.endsWith('/1.0.0');
      return { ...manifest(old ? '1.0.0' : '2.0.0'), engines: { node: old ? '>=18' : '>=20' } };
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'briefing.example') {
        return providerEnvelope(JSON.stringify(bullets('comparison.node')));
      }
      return new Response(null, { status: 503 });
    });

    const response = await startRequest('1.0.0', '2.0.0');
    expect(response).toMatchObject({ packageName: 'minimist', from: '1.0.0', to: '2.0.0' });
    const { briefing } = response;
    expect(briefing).toMatchObject({ status: 'available', model: 'test-model' });
    if (briefing.status !== 'available') throw new Error('Expected an available briefing');
    expect(briefing.bullets.map(({ kind, basis, evidenceIds }) => ({ kind, basis, evidenceIds }))).toEqual([
      { kind: 'change', basis: 'fact', evidenceIds: ['comparison.node'] },
    ]);
    // Coverage remains metadata even when no insight cites it.
    expect(briefing.sources.map((source) => source.id).sort()).toEqual(['comparison.node', 'coverage']);
  });

  it.each(['provider-error', 'invalid-response'])('reports %s without leaking provider text', async (failure) => {
    registry.json.mockImplementation(async (path) => {
      const old = path.endsWith('/1.0.0');
      return { ...manifest(old ? '1.0.0' : '2.0.0'), engines: { node: old ? '>=18' : '>=20' } };
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname !== 'briefing.example') return new Response(null, { status: 503 });
      return failure === 'invalid-response'
        ? providerEnvelope(JSON.stringify(bullets('invented-source')))
        : new Response('provider exploded', { status: 503 });
    });

    const response = await startRequest('1.0.0', '2.0.0');
    expect(response).toMatchObject({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: { status: 'unavailable', reason: failure, bullets: [], sources: [] },
    });
    expect(JSON.stringify(response)).not.toContain('provider exploded');
  });

  it('reports invalid configuration without calling the provider', async () => {
    vi.stubEnv('AI_BRIEFING_API_KEY', '');
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/1.0.0') ? '1.0.0' : '2.0.0'));

    const response = await startRequest('1.0.0', '2.0.0');
    expect(response).toMatchObject({ briefing: { status: 'unavailable', reason: 'invalid-config' } });
    expect(providerRequests()).toEqual([]);
  });

  it('fails closed when the request carries no database binding', async () => {
    registry.json.mockImplementation(async (path) => {
      const old = path.endsWith('/1.0.0');
      return { ...manifest(old ? '1.0.0' : '2.0.0'), engines: { node: old ? '>=18' : '>=20' } };
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'briefing.example') {
        return providerEnvelope(JSON.stringify(bullets('comparison.node')));
      }
      return new Response(null, { status: 503 });
    });

    // A dev proxy can hand the handler an environment without the binding; that is a failure, not a miss.
    const event = eventFor('1.0.0', '2.0.0');
    event.context.cloudflare = { env: {} };
    const response = await handler(event);

    expect(response).toMatchObject({
      packageName: 'minimist',
      from: '1.0.0',
      to: '2.0.0',
      briefing: { status: 'unavailable', reason: 'cache-error', bullets: [], sources: [] },
    });
    expect(providerRequests()).toEqual([]);
  });
});
