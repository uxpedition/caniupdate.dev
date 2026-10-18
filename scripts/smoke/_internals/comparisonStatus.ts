import { readFile } from 'node:fs/promises';

import { Miniflare, Response } from 'miniflare';
import type { V4FetchHandler } from 'miniflare';

import reviewedManifests from './reviewedManifests.json' with { type: 'json' };

type RuntimeOptions = {
  indexingEnabled?: boolean;
  reviewedEvidence?: 'available' | 'unavailable' | 'thin';
};

const fixtureManifest = (name: string, version: string, thin: boolean) => {
  const manifest = {
    name,
    version,
    engines: { node: name === 'unchanged-fixture' || version === '1.0.0' ? '>=18' : '>=20' },
    dist: { tarball: `https://registry.npmjs.org/${name}/-/fixture.tgz`, shasum: 'abc' },
  };

  const reviewed = reviewedManifests.find((item) => item.name === name && item.version === version);

  return thin || reviewed === undefined ? manifest : reviewed;
};

const registryFixture = (options: RuntimeOptions): V4FetchHandler => {
  const failedRecoveryVersions = new Set<string>();
  const unavailableNames = ['unavailable-fixture'];

  if (options.reviewedEvidence === 'unavailable') {
    unavailableNames.push(...reviewedManifests.map(({ name }) => name));
  }

  return async (request) => {
    const url = new URL(request.url);

    if (url.origin !== 'https://registry.npmjs.org') throw new Error('Unexpected external provider request');

    const [name = '', version = ''] = url.pathname.slice(1).split('/').map(decodeURIComponent);

    if (name === 'unknown-fixture' || version === '9.9.9') {
      return new Response('private-provider-marker', { status: 404 });
    }

    if (unavailableNames.includes(name)) return new Response('private-provider-marker', { status: 503 });

    if (name === 'recovery-fixture' && !failedRecoveryVersions.has(version)) {
      failedRecoveryVersions.add(version);

      return new Response('private-provider-marker', { status: 503 });
    }

    return Response.json(fixtureManifest(name, version, options.reviewedEvidence === 'thin'));
  };
};

/** Isolated frontend with fixed registry fixtures, no backend bindings or external network. */
export const comparisonStatusRuntime = async (port = 0, options: RuntimeOptions = {}) => {
  const script = await readFile('.output/workers/frontend/index.js', 'utf8');

  return new Miniflare({
    host: '127.0.0.1',
    port,
    workers: [
      {
        config: {
          name: 'comparison-status-smoke',
          compatibilityDate: '2026-09-25',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: script } } },
          assets: { directory: '.output/public', hasUserWorker: true },
          env: {
            PUBLIC_RATE_LIMITER: { type: 'rate-limit', namespace: '1001', simple: { limit: 1000, period: 60 } },
            NUXT_INDEXING_ENABLED: { type: 'text', value: String(options.indexingEnabled ?? false) },
            NUXT_PUBLIC_SITE_URL: { type: 'text', value: 'https://caniupdate.dev' },
          },
        },
        dev: { outboundService: { type: 'fetcher', handler: registryFixture(options) } },
      },
    ],
  });
};
