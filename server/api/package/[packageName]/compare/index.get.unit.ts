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
