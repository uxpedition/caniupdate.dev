import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { pack } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getComparisonFacts,
  getComparisonMeasurements,
  type ComparisonEvidenceCache,
  type ComparisonEvidenceCacheOptions,
} from './packageComparisonFacts';

const registry = { json: vi.fn<(path: string) => Promise<unknown>>() };

const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

const validTarball = async (): Promise<Buffer> => {
  const archive = pack();
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) throw new TypeError('Expected tar stream bytes');
      chunks.push(chunk);
    });
    archive.on('error', reject);
    archive.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));
  });
  archive.entry({ name: 'package/index.js', type: 'file', size: 11 }, Buffer.from('hello world'));
  archive.finalize();
  return complete;
};

const fetchMock = vi.fn<typeof fetch>();

class RecordingCache implements ComparisonEvidenceCache {
  readonly keys: string[] = [];
  readonly loaderCalls = new Map<string, number>();
  private readonly values = new Map<string, { value: unknown; expiresAt: number | null }>();
  now = 0;

  async load<T>(key: string, loader: () => Promise<T>, options: ComparisonEvidenceCacheOptions<T>): Promise<T> {
    this.keys.push(key);
    const current = this.values.get(key);
    if (current !== undefined && (current.expiresAt === null || current.expiresAt > this.now)) {
      if (!options.isValid(current.value)) throw new Error('Invalid cached fixture value');
      return current.value;
    }
    const value = await loader();
    this.loaderCalls.set(key, (this.loaderCalls.get(key) ?? 0) + 1);
    if (options.cacheable(value)) {
      this.values.set(key, {
        value,
        expiresAt: options.ttlMs === null ? null : this.now + options.ttlMs,
      });
    }
    return value;
  }
}

const startFacts = (from: string, to: string, packageName = 'minimist') =>
  Effect.runPromise(getComparisonFacts(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)));

const startMeasurements = (
  from: string,
  to: string,
  services: Parameters<typeof getComparisonMeasurements>[3],
  packageName = 'minimist',
) =>
  Effect.runPromise(
    getComparisonMeasurements(packageName, from, to, services).pipe(Effect.provide(FetchHttpClient.layer)),
  );

beforeEach(() => {
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

describe('comparison evidence cache services', () => {
  it('reuses successful mutable providers while retrying unavailable archives', async () => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'));
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
      if (url.hostname === 'bundlephobia.com') {
        const version = url.searchParams.get('package')?.split('@').at(-1) ?? '';
        return Response.json({ name: 'minimist', version, size: 100, gzip: 50 });
      }
      return Response.json({ malformed: true });
    });

    const cache = new RecordingCache();
    await startMeasurements('0.0.8', '1.2.8', { cache });
    await startMeasurements('0.0.8', '1.2.8', { cache });

    expect(registry.json).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([input, init]) => new URL(new Request(input, init).url));
    expect(requests.filter((url) => url.hostname === 'api.osv.dev')).toHaveLength(1);
    expect(requests.filter((url) => url.hostname === 'bundlephobia.com')).toHaveLength(2);
    expect(requests.filter((url) => url.hostname === 'registry.npmjs.org')).toHaveLength(4);
  });

  it('reuses one verified archive for versions with the same digest', async () => {
    const body = await validTarball();
    const shasum = createHash('sha1').update(body).digest('hex');
    registry.json.mockImplementation(async (path) => {
      const version = path.endsWith('/1.0.0') ? '1.0.0' : '2.0.0';
      return {
        name: 'widget',
        version,
        dist: {
          tarball: `https://registry.npmjs.org/widget/-/widget-${version}.tgz`,
          shasum,
        },
      };
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'registry.npmjs.org') return new Response(new Uint8Array(body));
      if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
      if (url.hostname === 'bundlephobia.com') {
        const version = url.searchParams.get('package')?.split('@').at(-1) ?? '';
        return Response.json({ name: 'widget', version, size: 100, gzip: 50 });
      }
      return new Response(null, { status: 404 });
    });

    const cache = new RecordingCache();
    const result = await startMeasurements('1.0.0', '2.0.0', { cache }, 'widget');
    expect(result.from.tarball.fileCount).toBe(1);
    expect(result.to.tarball.fileCount).toBe(1);
    expect([...cache.loaderCalls].filter(([key]) => key.startsWith('archive:'))).toHaveLength(1);
  });

  it('keys archives by exact SRI policy instead of falling back to SHA-1', async () => {
    let integrity: string | undefined = 'malformed-sri';
    registry.json.mockImplementation(async (path) => {
      const base = manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8');
      return integrity === undefined ? base : { ...base, dist: { ...base.dist, integrity } };
    });
    fetchMock.mockResolvedValue(Response.json({ malformed: true }));

    const sriCache = new RecordingCache();
    await startMeasurements('0.0.8', '1.2.8', { cache: sriCache });
    integrity = undefined;
    const sha1Cache = new RecordingCache();
    await startMeasurements('0.0.8', '1.2.8', { cache: sha1Cache });

    const sriKey = sriCache.keys.find((key) => key.startsWith('archive:'));
    const sha1Key = sha1Cache.keys.find((key) => key.startsWith('archive:'));
    expect(sriKey).toMatch(/^archive:[0-9a-f]{64}$/);
    expect(sha1Key).toMatch(/^archive:[0-9a-f]{64}$/);
    expect(sriKey).not.toBe(sha1Key);
  });

  it('expires mutable evidence without retaining a failed refresh', async () => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'));
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
      if (url.hostname === 'bundlephobia.com') {
        const version = url.searchParams.get('package')?.split('@').at(-1) ?? '';
        return Response.json({ name: 'minimist', version, size: 100, gzip: 50 });
      }
      return Response.json({ malformed: true });
    });

    const cache = new RecordingCache();
    await startMeasurements('0.0.8', '1.2.8', { cache });
    cache.now = 300_001;
    await startMeasurements('0.0.8', '1.2.8', { cache });

    expect([...cache.loaderCalls].filter(([key]) => key.startsWith('osv:'))[0]?.[1]).toBe(2);
    expect([...cache.loaderCalls].filter(([key]) => key.startsWith('bundle:')).every(([, count]) => count === 2)).toBe(
      true,
    );
  });
});

describe('comparison facts manifest resolution', () => {
  it.each(['1.2.8', 'latest'])('resolves each manifest once per request for %s', async (target) => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'));
    fetchMock.mockImplementation(async () => Response.json({ results: [{}, {}] }));

    await startFacts('0.0.8', target);

    // Declarations, measurements, and release notes share the request-local manifest effects.
    expect(registry.json.mock.calls.map(([path]) => path).sort()).toEqual([
      '/minimist/0.0.8',
      target === 'latest' ? '/minimist/latest' : '/minimist/1.2.8',
    ]);
  });
});
