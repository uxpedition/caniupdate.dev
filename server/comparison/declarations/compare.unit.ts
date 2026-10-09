import { describe, expect, it } from 'vitest';

import type { ComparisonVersion } from '#shared/comparison/comparison.defs';
import { toPackageVersion } from '#shared/comparison/package/package.defs';

import { compareDeclarations } from './compare';

function version(overrides: Partial<ComparisonVersion> = {}): ComparisonVersion {
  return {
    ...toPackageVersion({
      name: 'example',
      version: '1.0.0',
      dist: { tarball: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', shasum: 'abc' },
    }),
    vulnerabilities: { status: 'available', count: 0, advisories: [] },
    bundleSize: {
      provider: 'bundlephobia',
      url: 'https://bundlephobia.com',
      status: 'unavailable',
      size: null,
      gzip: null,
    },
    tarball: { status: 'unavailable', url: '', reasons: [], files: [], changelogs: [] },
    ...overrides,
  };
}

describe('declaration comparison rules', () => {
  it('distinguishes an explicit null export map from an absent declaration', () => {
    expect(compareDeclarations(version(), version({ moduleFormat: { exports: null } })).exports).toMatchObject({
      changed: true,
    });
  });

  it('ignores dependency ordering and overridden runtime ranges but retains additions and removals', () => {
    const from = version({
      dependencies: { same: '^1', overridden: 'old', removed: '*' },
      optionalDependencies: { overridden: '^2' },
    });
    const to = version({
      dependencies: { overridden: 'new', same: '^1', added: '*' },
      optionalDependencies: { overridden: '^2' },
    });
    expect(compareDeclarations(from, to).dependencies).toEqual([
      { name: 'added', kind: 'added', from: null, to: { category: 'runtime', range: '*' } },
      { name: 'removed', kind: 'removed', from: { category: 'runtime', range: '*' }, to: null },
    ]);
  });

  it('retains nested type conditions and condition precedence', () => {
    const from = version({ moduleFormat: { exports: { '.': { import: { types: './a.d.ts', default: './a.js' } } } } });
    const to = version({ moduleFormat: { exports: { '.': { import: { default: './a.js', types: './a.d.ts' } } } } });
    expect(compareDeclarations(from, to)).toMatchObject({ exports: { changed: true }, types: { changed: true } });
    expect(compareDeclarations(from, from)).toMatchObject({ exports: { changed: false }, types: { changed: false } });
  });

  it('compares declarations from manifest fields without measurement evidence', () => {
    const from = {
      name: 'example-package',
      version: '1.0.0',
      dist: { tarball: 'https://registry.npmjs.org/example-package/-/example-package-1.0.0.tgz' },
      licenses: ['MIT'],
      deprecated: false,
      engines: { node: '>=18' },
      dependencies: { dep: '^1.0.0' },
      peerDependencies: {},
      optionalDependencies: {},
      optionalPeers: [],
      installScripts: [],
      installScriptCommands: {},
      moduleFormat: { main: 'index.js' },
    };
    const to = { ...from, version: '2.0.0', engines: { node: '>=20' } };

    expect(compareDeclarations(from, to)).toMatchObject({
      node: { changed: true, from: '>=18', to: '>=20' },
      dependencies: [],
      peers: [],
      installScripts: [],
    });
  });
});
