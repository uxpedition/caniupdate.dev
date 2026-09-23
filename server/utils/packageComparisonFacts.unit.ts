import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getComparisonFacts as getComparisonFactsType } from './packageComparisonFacts';

const registry = { json: vi.fn<(path: string) => Promise<unknown>>() };

const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

const fetchMock = vi.fn<typeof fetch>();
let getComparisonFacts: typeof getComparisonFactsType;

const startFacts = (from: string, to: string, packageName = 'minimist') =>
  Effect.runPromise(getComparisonFacts(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)));

beforeEach(async () => {
  // Reload the module boundary so each test owns fresh process-local caches.
  vi.resetModules();
  ({ getComparisonFacts } = await import('./packageComparisonFacts'));
  registry.json.mockReset();
  fetchMock.mockReset();
  // Registry manifests are served from the fetch boundary; tarballs (`/-/`) and evidence providers stay with fetchMock.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    if (url.origin === 'https://registry.npmjs.org' && !url.pathname.includes('/-/')) {
      return Response.json(await registry.json(url.pathname));
    }
    return fetchMock(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('comparison facts release-note scheduling', () => {
  it.each(['1.2.8', 'latest'])('starts GitHub evidence while OSV is pending for %s', async (target) => {
    const osvGate = Promise.withResolvers<Response>();
    const calls: string[] = [];
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'),
      repository: { type: 'git', url: 'git+https://github.com/minimistjs/minimist.git' },
      gitHead: 'a'.repeat(40),
    }));
    fetchMock.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      calls.push(request.url);
      if (request.url.startsWith('https://api.osv.dev/')) return osvGate.promise;
      if (new URL(request.url).pathname.endsWith('/releases')) {
        return Response.json([
          {
            tag_name: 'v1.2.8',
            name: '1.2.8',
            body: 'Release fixes',
            html_url: 'https://github.com/minimistjs/minimist/releases/tag/v1.2.8',
            draft: false,
            prerelease: false,
          },
        ]);
      }
      return Response.json({ message: 'Not Found' }, { status: 404 });
    });
    const pending = startFacts('0.0.8', target);
    try {
      await vi.waitFor(() => {
        expect(calls.some((url) => url.includes('api.osv.dev'))).toBe(true);
        expect(calls.some((url) => url.includes('api.github.com/repos/minimistjs/minimist/releases'))).toBe(true);
        expect(calls.some((url) => url.includes('/contents') && url.includes('ref='))).toBe(true);
      });
    } finally {
      osvGate.resolve(Response.json({ results: [{}, {}] }));
      await pending;
    }
    expect(await pending).toMatchObject({
      releaseNotes: { status: 'partial', releases: [{ version: '1.2.8', body: 'Release fixes' }] },
      to: { version: '1.2.8', vulnerabilities: { status: 'available', count: 0 } },
    });
  });

  it('preserves npm and OSV evidence without GitHub requests for other hosts', async () => {
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'),
      repository: { url: 'https://gitlab.com/example/minimist.git' },
    }));
    const calls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      calls.push(new Request(input, init).url);
      return Response.json({ results: [{}, {}] });
    });
    expect(await startFacts('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable', releases: [], changelog: null },
      to: { version: '1.2.8', vulnerabilities: { status: 'available' } },
    });
    expect(calls.some((url) => url.startsWith('https://api.github.com/'))).toBe(false);
  });

  it('fetches the pinned changelog body before release pagination finishes', async () => {
    const releasesGate = Promise.withResolvers<Response>();
    const calls: string[] = [];
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'),
      repository: 'https://github.com/minimistjs/minimist',
      gitHead: 'a'.repeat(40),
    }));
    fetchMock.mockImplementation(async (input, init) => {
      const url = new Request(input, init).url;
      calls.push(url);
      if (url.includes('api.osv.dev')) return Response.json({ results: [{}, {}] });
      if (new URL(url).pathname.endsWith('/releases')) return releasesGate.promise;
      if (new URL(url).pathname.endsWith('/CHANGELOG.md')) return new Response('Version history');
      return Response.json([{ name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' }]);
    });
    const pending = startFacts('0.0.8', '1.2.8');
    try {
      await vi.waitFor(() => expect(calls.some((url) => url.includes('/CHANGELOG.md?'))).toBe(true));
    } finally {
      releasesGate.resolve(Response.json([]));
      await pending;
    }
    expect(await pending).toMatchObject({ releaseNotes: { changelog: { body: 'Version history' } } });
  });

  it('keeps invalid optional repository metadata from failing the comparison', async () => {
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'),
      repository: { url: 42 },
    }));
    fetchMock.mockResolvedValue(Response.json({ results: [{}, {}] }));
    expect(await startFacts('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable' },
      to: { version: '1.2.8', vulnerabilities: { count: 0 } },
    });
  });

  it('retains registry and OSV results when GitHub is rate limited', async () => {
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'),
      repository: 'https://github.com/minimistjs/minimist',
      gitHead: 'a'.repeat(40),
    }));
    fetchMock.mockImplementation(async (input, init) => {
      const url = new Request(input, init).url;
      return url.startsWith('https://api.github.com/')
        ? Response.json({ message: 'API rate limit exceeded' }, { status: 403 })
        : Response.json({ results: [{}, {}] });
    });
    expect(await startFacts('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable', releases: [], changelog: null },
      from: { version: '0.0.8', vulnerabilities: { count: 0 } },
      to: { version: '1.2.8', vulnerabilities: { count: 0 } },
    });
  });
});
