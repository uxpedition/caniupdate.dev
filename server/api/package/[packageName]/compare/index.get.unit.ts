import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { mockEvent } from 'h3';
import { pack } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type endpointHandler from './index.get';

let handler: typeof endpointHandler;

const registry = vi.hoisted(() => ({ json: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock('npm-registry-fetch', () => ({ default: registry }));

const modified = '2026-03-13T22:11:31.390433Z';
const manifest = (version: string) => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/minimist-${version}.tgz`, shasum: 'abc' },
});

function startRequest(from: string, to: string, packageName = 'minimist') {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare?${new URLSearchParams({ from, to })}`,
  );
  event.context.params = { packageName: encodeURIComponent(packageName) };
  return Promise.resolve(handler(event));
}

const fetchMock = vi.fn<typeof fetch>();

describe('factual comparison', () => {
  it('never calls the AI provider and omits the briefing field', async () => {
    // AI configuration is present, so the factual route must ignore it rather than generate inline.
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-only-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    registry.json.mockImplementation(async (path) => {
      const old = path.endsWith('/1.0.0');
      return { ...manifest(old ? '1.0.0' : '2.0.0'), engines: { node: old ? '>=18' : '>=20' } };
    });
    const providerCalls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'briefing.example') providerCalls.push(url.href);
      return new Response(null, { status: 503 });
    });

    const response = await startRequest('1.0.0', '2.0.0');
    expect(response).toMatchObject({
      comparison: { node: { changed: true, from: '>=18', to: '>=20' } },
    });
    expect(response).not.toHaveProperty('briefing');
    expect(providerCalls).toEqual([]);
  });
});

beforeEach(async () => {
  // Reload the module boundary so each test owns fresh process-local caches.
  vi.resetModules();
  handler = (await import('./index.get')).default;
  registry.json.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function cacheFixtureTarball() {
  const output = pack();
  const chunks: Buffer[] = [];
  const reading = (async () => {
    for await (const chunk of output) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture chunk');
      chunks.push(chunk);
    }
  })();
  output.entry({ name: 'package/CHANGES.md' }, 'Published fixes');
  output.finalize();
  await reading;
  return gzipSync(Buffer.concat(chunks));
}

function installCacheFixtures(tarball: Buffer) {
  registry.json.mockImplementation(async (path) => ({
    ...manifest(path.slice(path.lastIndexOf('/') + 1)),
    dist: {
      tarball: `https://registry.npmjs.org/minimist/-/${path.slice(path.lastIndexOf('/') + 1)}.tgz`,
      shasum: createHash('sha1').update(tarball).digest('hex'),
    },
    repository: 'https://github.com/minimistjs/minimist',
    gitHead: 'a'.repeat(40),
  }));
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
    if (url.hostname === 'bundlephobia.com') {
      const version = url.searchParams.get('package')?.split('@').at(-1);
      return Response.json({ name: 'minimist', version, size: 100, gzip: 50 });
    }
    if (url.hostname === 'registry.npmjs.org') return new Response(new Uint8Array(tarball));
    if (url.pathname.endsWith('/releases')) return Response.json([]);
    if (url.pathname.endsWith('/CHANGES.md')) return new Response('Published fixes');
    return Response.json([{ name: 'CHANGES.md', path: 'CHANGES.md', type: 'file' }]);
  });
}

describe('evidence caching', () => {
  it('expires mutable evidence without refetching pinned content or fresh bundle measurements', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    installCacheFixtures(await cacheFixtureTarball());
    const first = await startRequest('1.0.0', '2.0.0');
    registry.json.mockClear();
    fetchMock.mockClear();
    vi.setSystemTime(300_000);
    const refreshed = await startRequest('1.0.0', '2.0.0');
    expect(refreshed.from.bundleSize).toEqual(first.from.bundleSize);
    expect(refreshed.to.tarball).toEqual(first.to.tarball);
    expect(registry.json).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input, init]) => new Request(input, init).url).sort()).toEqual([
      'https://api.github.com/repos/minimistjs/minimist/releases?page=1&per_page=100',
      'https://api.osv.dev/v1/querybatch',
    ]);
    vi.setSystemTime(3_600_000);
    const rebuilt = await startRequest('1.0.0', '2.0.0');
    expect(rebuilt.from.bundleSize).toMatchObject({
      status: 'available',
      retrievedAt: new Date(3_600_000).toISOString(),
    });
  });

  it('resolves mutable tags again while keeping exact manifest lookups cached', async () => {
    let latest = '2.0.0';
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/latest') ? latest : '1.0.0'));
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
    expect(await startRequest('1.0.0', 'latest')).toMatchObject({ to: { version: '2.0.0' } });
    latest = '3.0.0';
    expect(await startRequest('1.0.0', 'latest')).toMatchObject({ to: { version: '3.0.0' } });
    expect(registry.json.mock.calls.map(([path]) => path)).toEqual([
      '/minimist/1.0.0',
      '/minimist/latest',
      '/minimist/latest',
    ]);
  });

  it('shares concurrent lookups and reuses successful evidence without refetching', async () => {
    installCacheFixtures(await cacheFixtureTarball());
    const [first, concurrent] = await Promise.all([startRequest('1.0.0', '2.0.0'), startRequest('1.0.0', '2.0.0')]);
    expect(first).toMatchObject({
      from: { tarball: { status: 'available' }, bundleSize: { status: 'available' } },
      to: { vulnerabilities: { status: 'available' } },
    });
    expect(concurrent).toEqual(first);
    expect(registry.json).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    const repeated = await startRequest('1.0.0', '2.0.0');
    expect(repeated).toEqual(first);
    expect(registry.json).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('reuses per-version and repository evidence across overlapping comparisons', async () => {
    installCacheFixtures(await cacheFixtureTarball());
    await startRequest('1.0.0', '2.0.0');
    registry.json.mockClear();
    fetchMock.mockClear();
    expect(await startRequest('2.0.0', '3.0.0')).toMatchObject({
      from: { version: '2.0.0' },
      to: { version: '3.0.0', tarball: { status: 'available' } },
    });
    expect(registry.json.mock.calls).toEqual([['/minimist/3.0.0']]);
    const urls = fetchMock.mock.calls.map(([input, init]) => new Request(input, init).url).sort();
    expect(urls).toEqual([
      'https://api.osv.dev/v1/querybatch',
      'https://bundlephobia.com/api/size?package=minimist%403.0.0',
      'https://registry.npmjs.org/minimist/-/3.0.0.tgz',
    ]);
  });
});

describe('early tarball scheduling', () => {
  it.each(['2.0.0', 'latest'])(
    'downloads a resolved version while the other manifest is pending (%s)',
    async (target) => {
      const gate = Promise.withResolvers<void>();
      const downloads: string[] = [];
      registry.json.mockImplementation(async (path) => {
        if (!path.endsWith('/1.0.0')) await gate.promise;
        return manifest(path.endsWith('/1.0.0') ? '1.0.0' : '2.0.0');
      });
      fetchMock.mockImplementation(async (input, init) => {
        const url = new URL(new Request(input, init).url);
        if (url.hostname === 'registry.npmjs.org') downloads.push(url.pathname);
        return url.hostname === 'api.osv.dev'
          ? Response.json({ results: [{}, {}] })
          : new Response(null, { status: 503 });
      });
      const pending = startRequest('1.0.0', target);
      try {
        await vi.waitFor(() => expect(downloads).toEqual(['/minimist/-/minimist-1.0.0.tgz']));
      } finally {
        gate.resolve();
        await pending;
      }
      expect(downloads).toEqual(['/minimist/-/minimist-1.0.0.tgz', '/minimist/-/minimist-2.0.0.tgz']);
    },
  );
});

describe('local comparison', () => {
  it('compares declarations even when external evidence is unavailable', async () => {
    registry.json.mockImplementation(async (path) => {
      const old = path.endsWith('/1.0.0');
      return {
        ...manifest(old ? '1.0.0' : '2.0.0'),
        dependencies: { moved: '^1', overridden: '^1' },
        optionalDependencies: old ? { overridden: '^2' } : { overridden: '^2', moved: '^1' },
        peerDependencies: { peer: '^1' },
        peerDependenciesMeta: { peer: { optional: old } },
        engines: old ? { node: '>=18' } : { node: '>=20' },
        type: old ? 'commonjs' : 'module',
        exports: old ? { default: './index.js', import: './esm.js' } : { import: './esm.js', default: './index.js' },
        typings: old ? './old.d.ts' : './new.d.ts',
        scripts: { install: old ? 'node old.js' : 'node new.js' },
        license: old ? 'MIT' : 'ISC',
      };
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const response = await startRequest('1.0.0', '2.0.0');
    expect(response).toMatchObject({
      comparison: {
        dependencies: [
          {
            name: 'moved',
            kind: 'changed',
            from: { category: 'runtime', range: '^1' },
            to: { category: 'optional', range: '^1' },
          },
        ],
        peers: [
          {
            name: 'peer',
            kind: 'changed',
            from: { range: '^1', optional: true },
            to: { range: '^1', optional: false },
          },
        ],
        node: { changed: true, from: '>=18', to: '>=20' },
        moduleFormat: { changed: true },
        exports: { changed: true },
        types: { changed: true, from: { typings: './old.d.ts' }, to: { typings: './new.d.ts' } },
        licenses: { added: ['ISC'], removed: ['MIT'] },
        installScripts: [{ name: 'install', kind: 'changed', from: 'node old.js', to: 'node new.js' }],
        sizes: { unpacked: { from: null, to: null, delta: null, percent: null } },
        advisories: { status: 'unavailable', fromOnly: [], both: [], toOnly: [] },
      },
    });
  });
});

describe('tarball evidence', () => {
  it.each(['1.2.8', 'latest'])('inspects both resolved tarballs while OSV is pending for %s', async (target) => {
    const output = pack();
    const chunks: Buffer[] = [];
    const reading = (async () => {
      for await (const chunk of output) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture chunk');
        chunks.push(chunk);
      }
    })();
    output.entry({ name: 'package/CHANGES.md' }, 'Published fixes');
    output.finalize();
    await reading;
    const tarball = gzipSync(Buffer.concat(chunks));
    const osvGate = Promise.withResolvers<Response>();
    const tarballGate = Promise.withResolvers<void>();
    const downloads: string[] = [];
    registry.json.mockImplementation(async (path) => {
      const result = manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8');
      result.dist.shasum = createHash('sha1').update(tarball).digest('hex');
      return result;
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'api.osv.dev') return osvGate.promise;
      if (url.hostname === 'registry.npmjs.org') {
        downloads.push(url.pathname);
        await tarballGate.promise;
        return new Response(new Uint8Array(tarball));
      }
      return new Response(null, { status: 404 });
    });
    const pending = startRequest('0.0.8', target);
    try {
      await vi.waitFor(() =>
        expect(downloads.sort()).toEqual(['/minimist/-/minimist-0.0.8.tgz', '/minimist/-/minimist-1.2.8.tgz']),
      );
    } finally {
      tarballGate.resolve();
      osvGate.resolve(Response.json({ results: [{}, {}] }));
    }
    const evidence = { status: 'available', changelogs: [{ path: 'CHANGES.md', body: 'Published fixes' }] };
    expect(await pending).toMatchObject({
      from: { tarball: evidence, vulnerabilities: { count: 0 } },
      to: { version: '1.2.8', tarball: evidence, vulnerabilities: { count: 0 } },
    });
  });
});

describe('Bundlephobia evidence', () => {
  it.each(['1.2.8', 'latest'])('fetches both scoped versions independently of pending OSV for %s', async (target) => {
    const npmGate = Promise.withResolvers<void>();
    const osvGate = Promise.withResolvers<Response>();
    const packages: string[] = [];
    registry.json.mockImplementation(async (path) => {
      await npmGate.promise;
      return { ...manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'), name: '@example/pkg' };
    });
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'api.osv.dev') return osvGate.promise;
      if (url.hostname !== 'bundlephobia.com' || url.pathname !== '/api/size')
        return new Response(null, { status: 404 });
      const pkg = url.searchParams.get('package');
      if (pkg === null) return new Response(null, { status: 400 });
      packages.push(pkg);
      const version = pkg.slice(pkg.lastIndexOf('@') + 1);
      return Response.json({
        name: '@example/pkg',
        version,
        size: version === '0.0.8' ? 100 : 120,
        gzip: 60,
        hasJSModule: true,
        ignoredMissingDependencies: ['optional-native'],
      });
    });
    const pending = startRequest('0.0.8', target, '@example/pkg');
    try {
      if (target === 'latest') {
        await vi.waitFor(() => expect(registry.json).toHaveBeenCalledTimes(2));
        expect(packages).toEqual([]);
        npmGate.resolve();
      }
      await vi.waitFor(() => expect(packages.sort()).toEqual(['@example/pkg@0.0.8', '@example/pkg@1.2.8']));
    } finally {
      npmGate.resolve();
      osvGate.resolve(Response.json({ results: [{}, {}] }));
    }
    expect(await pending).toMatchObject({
      from: { bundleSize: { status: 'available', provider: 'bundlephobia', size: 100, gzip: 60 } },
      to: {
        version: '1.2.8',
        bundleSize: {
          status: 'available',
          size: 120,
          gzip: 60,
          hasJSModule: true,
          ignoredMissingDependencies: ['optional-native'],
        },
      },
    });
  });

  it.each([
    { label: 'wrong package', body: { name: 'other', version: '0.0.8', size: 100, gzip: 50 }, status: 200 },
    { label: 'wrong version', body: { name: 'minimist', version: '9.0.0', size: 100, gzip: 50 }, status: 200 },
    { label: 'invalid bytes', body: { name: 'minimist', version: '0.0.8', size: -1, gzip: 50 }, status: 200 },
    { label: 'missing measurement', body: { name: 'minimist', version: '0.0.8', size: 100 }, status: 200 },
    { label: 'build failure', body: { type: 'BuildError' }, status: 422 },
    { label: 'rate limit', body: { message: 'Too many requests' }, status: 429 },
  ])('preserves the other measurement and evidence on $label', async ({ body, status }) => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'));
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
      return url.searchParams.get('package') === 'minimist@0.0.8'
        ? Response.json(body, { status })
        : Response.json({ name: 'minimist', version: '1.2.8', size: 0, gzip: 0 });
    });
    expect(await startRequest('0.0.8', '1.2.8')).toMatchObject({
      from: { bundleSize: { status: 'unavailable', size: null, gzip: null }, vulnerabilities: { count: 0 } },
      to: { bundleSize: { status: 'available', size: 0, gzip: 0 }, vulnerabilities: { count: 0 } },
    });
  });

  it('bounds a stalled measurement without losing the completed version', async () => {
    vi.useFakeTimers();
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/0.0.8') ? '0.0.8' : '1.2.8'));
    let stalledSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === 'api.osv.dev') return Response.json({ results: [{}, {}] });
      if (url.searchParams.get('package') === 'minimist@0.0.8') {
        stalledSignal = request.signal;
        return new Promise<Response>((_, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }),
        );
      }
      return Response.json({ name: 'minimist', version: '1.2.8', size: 120, gzip: 60 });
    });
    const pending = startRequest('0.0.8', '1.2.8');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({
      from: { bundleSize: { status: 'unavailable', size: null, gzip: null } },
      to: { bundleSize: { status: 'available', size: 120, gzip: 60 } },
    });
    expect(stalledSignal?.aborted).toBe(true);
  });
});

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
        const osvUrls = urls.filter((url) => url.startsWith('https://api.osv.dev/'));
        expect(osvUrls[0]).toBe('https://api.osv.dev/v1/querybatch');
        expect(osvUrls.slice(1).sort()).toEqual(['https://api.osv.dev/v1/vulns/A', 'https://api.osv.dev/v1/vulns/B']);
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
      const request = new Request(input, init);
      if (request.url.startsWith('https://api.osv.dev/')) batches.push(await request.json());
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
