import { mockEvent } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from './index.get';

const registry = { json: vi.fn<(path: string) => Promise<unknown>>() };

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
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('declaration comparison', () => {
  it('returns manifest declarations without measurement or release evidence', async () => {
    registry.json.mockImplementation(async (path) => ({
      ...manifest(path.endsWith('/1.0.0') ? '1.0.0' : '2.0.0'),
      engines: { node: path.endsWith('/1.0.0') ? '>=18' : '>=20' },
      repository: { type: 'git', url: 'git+https://github.com/minimistjs/minimist.git' },
    }));
    fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));

    const response = await startRequest('1.0.0', '2.0.0');

    expect(response).toMatchObject({
      packageName: 'minimist',
      from: { version: '1.0.0' },
      to: { version: '2.0.0' },
      comparison: { node: { changed: true, from: '>=18', to: '>=20' } },
    });
    expect(response).not.toHaveProperty('releaseNotes');
    expect(response.from).not.toHaveProperty('tarball');
    expect(response.from).not.toHaveProperty('vulnerabilities');
    expect(response.from).not.toHaveProperty('bundleSize');
    expect(response.comparison).not.toHaveProperty('sizes');
    expect(response.comparison).not.toHaveProperty('advisories');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves tags to exact versions without measurement providers', async () => {
    registry.json.mockImplementation(async (path) => manifest(path.endsWith('/latest') ? '2.0.0' : '1.0.0'));
    fetchMock.mockImplementation(async () => {
      throw new Error('the declarations route must not call evidence providers');
    });

    expect(await startRequest('1.0.0', 'latest')).toMatchObject({ to: { version: '2.0.0' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls the AI provider and omits the briefing field', async () => {
    // AI configuration is present, so the declarations route must ignore it rather than generate inline.
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('compares declarations even when evidence providers are unavailable', async () => {
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
      },
    });
  });
});
