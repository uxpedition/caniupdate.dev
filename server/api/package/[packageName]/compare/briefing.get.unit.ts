import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mockEvent } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type endpointHandler from './briefing.get';

let handler: typeof endpointHandler;
let databaseDirectory: string;
let closeStore: () => void;

const registry = vi.hoisted(() => ({ json: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock('npm-registry-fetch', () => ({ default: registry }));

const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

function startRequest(from: string, to: string, packageName = 'minimist') {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare/briefing?${new URLSearchParams({ from, to })}`,
  );
  event.context.params = { packageName: encodeURIComponent(packageName) };
  return Promise.resolve(handler(event));
}

const fetchMock = vi.fn<typeof fetch>();

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
  beforeEach(async () => {
    databaseDirectory = await mkdtemp(join(tmpdir(), 'briefing-route-'));
    vi.stubEnv('AI_BRIEFING_CACHE_PATH', join(databaseDirectory, 'briefings.db'));
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-only-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    // Reload the module boundary so each test owns fresh process-local caches.
    vi.resetModules();
    handler = (await import('./briefing.get')).default;
    ({ closeBriefingStore: closeStore } = await import('../../../../utils/packageBriefingStore'));
    registry.json.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    closeStore();
    await rm(databaseDirectory, { recursive: true, force: true });
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
    expect(
      fetchMock.mock.calls
        .map(([input, init]) => new Request(input, init).url)
        .filter((url) => url.includes('briefing.example')),
    ).toEqual([]);
  });
});
