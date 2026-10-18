import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { getComparisonDeclarations } from './collect';

const versions = ['1.0.0', '1.2.8', '2.0.0-beta.1', '2.0.0-beta.2', '2.0.0'];

const compare = (from: string, to: string, packageName = '@example/package') => {
  const requests: string[] = [];

  const manifest = (version: string) => ({
    name: packageName,
    version,
    dist: { tarball: 'https://registry.npmjs.org/example/-/example.tgz', shasum: 'abc' },
    engines: { node: version === '1.2.8' ? '>=18' : '>=20' },
  });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    requests.push(url.pathname);
    const prefix = `/${encodeURIComponent(packageName)}`;

    if (url.pathname === prefix) {
      return Response.json({
        name: packageName,
        modified: '2026-10-18T00:00:00.000Z',
        'dist-tags': { latest: '2.0.0' },
        versions: Object.fromEntries(
          versions.map((version) => {
            const { name, dist } = manifest(version);

            return [version, { name, version, dist }];
          }),
        ),
      });
    }

    const selector = decodeURIComponent(url.pathname.slice(prefix.length + 1));
    const version = selector === 'latest' ? '2.0.0' : selector;

    return versions.includes(version)
      ? Response.json(manifest(version))
      : Response.json({ error: 'version not found' }, { status: 404 });
  };

  return {
    requests,
    result: Effect.runPromise(
      getComparisonDeclarations(packageName, from, to).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    ),
  };
};

describe('comparison registry selectors', () => {
  it('resolves ranges to the highest matching release without reversing the comparison', async () => {
    const { result, requests } = compare('latest', '^1.0.0');

    expect(await result).toMatchObject({
      packageName: '@example/package',
      from: { version: '2.0.0' },
      to: { version: '1.2.8', engines: { node: '>=18' } },
    });
    expect(requests).toContain('/%40example%2Fpackage/1.2.8');
    expect(requests.every((path) => !path.includes('%252F'))).toBe(true);
  });

  it('excludes prereleases from stable ranges but honors explicit prerelease bounds', async () => {
    expect(await compare('>=1.0.0 <2.0.0', '>=2.0.0-beta.1 <2.0.0').result).toMatchObject({
      from: { version: '1.2.8' },
      to: { version: '2.0.0-beta.2' },
    });
  });

  it.each(['^9.0.0', 'not a valid selector'])('does not fall back to latest for %s', async (selector) => {
    await expect(compare(selector, 'latest').result).rejects.toMatchObject({ _tag: 'RegistryRequestError' });
  });
});
