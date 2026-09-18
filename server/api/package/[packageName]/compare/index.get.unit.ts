import { mockEvent } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from './index.get';

const registry = vi.hoisted(() => ({ json: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock('npm-registry-fetch', () => ({ default: registry }));

const modified = '2026-03-13T22:11:31.390433Z';
const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

function startRequest(from: string, to: string) {
  const event = mockEvent(`http://localhost/api/package/minimist/compare?${new URLSearchParams({ from, to })}`);
  event.context.params = { packageName: 'minimist' };
  return Promise.resolve(handler(event));
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  registry.json.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('comparison request scheduling', () => {
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
    const pending = startRequest('0.0.8', target);
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
    expect(registry.json).toHaveBeenCalledTimes(2);
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
    expect(await startRequest('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable', releases: [], changelog: null },
      to: { version: '1.2.8', vulnerabilities: { status: 'available' } },
    });
    expect(calls).toEqual(['https://api.osv.dev/v1/querybatch']);
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
    const pending = startRequest('0.0.8', '1.2.8');
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
    expect(await startRequest('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable' },
      to: { version: '1.2.8', vulnerabilities: { count: 0 } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(await startRequest('0.0.8', '1.2.8')).toMatchObject({
      releaseNotes: { status: 'unavailable', releases: [], changelog: null },
      from: { version: '0.0.8', vulnerabilities: { count: 0 } },
      to: { version: '1.2.8', vulnerabilities: { count: 0 } },
    });
  });

  it('starts both npm requests and finishes unique OSV lookups while npm is still pending', async () => {
    const fromGate = Promise.withResolvers<unknown>();
    const toGate = Promise.withResolvers<unknown>();
    registry.json.mockImplementation((path) => (path.endsWith('/0.0.8') ? fromGate.promise : toGate.promise));
    const urls: string[] = [];
    const batches: unknown[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      urls.push(request.url);
      if (request.method === 'POST') {
        batches.push(await request.json());
        return Response.json({
          results: [
            {
              vulns: [
                { id: 'A', modified },
                { id: 'B', modified },
              ],
            },
            { vulns: [{ id: 'B', modified }] },
          ],
        });
      }
      return Response.json({ id: request.url.endsWith('/A') ? 'A' : 'B', modified });
    });

    const pending = startRequest('0.0.8', '1.2.5');
    try {
      await vi.waitFor(() => {
        expect(registry.json.mock.calls.map(([path]) => path).sort()).toEqual(['/minimist/0.0.8', '/minimist/1.2.5']);
        expect(urls[0]).toBe('https://api.osv.dev/v1/querybatch');
        expect(urls.slice(1).sort()).toEqual(['https://api.osv.dev/v1/vulns/A', 'https://api.osv.dev/v1/vulns/B']);
      });
    } finally {
      fromGate.resolve(manifest('0.0.8'));
      toGate.resolve(manifest('1.2.5'));
      await pending;
    }

    expect(batches).toEqual([
      {
        queries: [
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '0.0.8' },
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.5' },
        ],
      },
    ]);
    expect(await pending).toMatchObject({
      from: { version: '0.0.8', vulnerabilities: { count: 2 } },
      to: { version: '1.2.5', vulnerabilities: { count: 1 } },
    });
  });

  it('fetches both manifests concurrently but resolves tags before its single OSV batch', async () => {
    const fromGate = Promise.withResolvers<unknown>();
    const toGate = Promise.withResolvers<unknown>();
    registry.json.mockImplementation((path) => (path.endsWith('/0.0.8') ? fromGate.promise : toGate.promise));
    const batches: unknown[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      batches.push(await new Request(input, init).json());
      return Response.json({ results: [{}, {}] });
    });

    const pending = startRequest('0.0.8', 'latest');
    try {
      await vi.waitFor(() =>
        expect(registry.json.mock.calls.map(([path]) => path).sort()).toEqual(['/minimist/0.0.8', '/minimist/latest']),
      );
      expect(batches).toEqual([]);
    } finally {
      fromGate.resolve(manifest('0.0.8'));
      toGate.resolve(manifest('1.2.8'));
      await pending;
    }

    expect(batches).toEqual([
      {
        queries: [
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '0.0.8' },
          { package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.8' },
        ],
      },
    ]);
    expect(await pending).toMatchObject({
      to: { version: '1.2.8', vulnerabilities: { status: 'available', count: 0 } },
    });
  });
});
