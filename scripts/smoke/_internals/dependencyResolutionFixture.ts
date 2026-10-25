import { readFile } from 'node:fs/promises';

import { Log, LogLevel, Miniflare, Response, type V4FetchHandler } from 'miniflare';

export type DependencyFixture = {
  readonly runtime: Miniflare;
  readonly metadataCalls: number;
  setUnavailable(value: boolean): void;
};

const versions = ['1.2.3', '1.9.9', '2.1.0', '2.9.0', '3.0.0-beta.1'];

const manifest = (name: string, version: string) => ({
  name,
  version,
  dist: { tarball: `https://registry.npmjs.org/${encodeURIComponent(name)}/-/fixture.tgz`, shasum: 'abc' },
  dependencies: name === '@scope/parent' ? { '@scope/child': version === '1.0.0' ? '1.x' : '2.x' } : {},
});

function createProviderFixture() {
  let metadataCalls = 0;
  let unavailable = false;

  const provider: V4FetchHandler = async (request) => {
    const url = new URL(request.url);

    if (url.origin !== 'https://registry.npmjs.org' || url.pathname.includes('/-/')) {
      return new Response(null, { status: 503 });
    }

    const [name = '', version] = url.pathname.slice(1).split('/').map(decodeURIComponent);

    if (version !== undefined) return Response.json(manifest(name, version));

    if (name === '@scope/child') metadataCalls += 1;

    if (unavailable) return new Response('private-provider-marker', { status: 429 });

    return Response.json({
      name,
      modified: '2026-10-01',
      'dist-tags': {},
      versions: Object.fromEntries(versions.map((release) => [release, manifest(name, release)])),
    });
  };

  return {
    provider,
    get metadataCalls() {
      return metadataCalls;
    },
    setUnavailable(value: boolean) {
      unavailable = value;
    },
  };
}

function createRuntime(frontend: string, evidence: string, port: number, provider: V4FetchHandler) {
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port,
    log: new Log(LogLevel.ERROR),
    workers: [
      {
        config: {
          name: 'dependency-frontend',
          compatibilityDate: '2026-09-25',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: frontend } } },
          assets: { directory: '.output/public', hasUserWorker: true },
          env: {
            PUBLIC_RATE_LIMITER: { type: 'rate-limit', namespace: '1001', simple: { limit: 1000, period: 60 } },
            PACKAGE_EVIDENCE: { type: 'durable-object', worker: 'dependency-evidence', exportName: 'PackageEvidence' },
          },
        },
        dev: { outboundService: { type: 'fetcher', handler: provider } },
      },
      {
        config: {
          name: 'dependency-evidence',
          compatibilityDate: '2026-09-25',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: evidence } } },
          exports: { PackageEvidence: { type: 'durable-object', storage: 'sqlite' } },
        },
        dev: { outboundService: { type: 'fetcher', handler: provider } },
      },
    ],
  });

  return runtime;
}

/** Both production Workers run together; only external providers are replaced with deterministic fixtures. */
export async function dependencyResolutionRuntime(port = 0): Promise<DependencyFixture> {
  const frontend = await readFile('.output/workers/frontend/index.js', 'utf8');
  const evidence = await readFile('.output/workers/evidence/index.js', 'utf8');
  const fixture = createProviderFixture();
  const runtime = createRuntime(frontend, evidence, port, fixture.provider);

  return {
    runtime,
    get metadataCalls() {
      return fixture.metadataCalls;
    },
    setUnavailable(value: boolean) {
      fixture.setUnavailable(value);
    },
  };
}
