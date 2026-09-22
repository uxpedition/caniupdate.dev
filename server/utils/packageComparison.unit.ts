import { describe, expect, it } from 'vitest';

import type { ComparisonVersion } from '#shared/comparison.defs';
import type { PackageAdvisory, PackageVulnerabilities } from '#shared/osv.defs';
import { toPackageVersion } from '#shared/package.defs';

import { compareDeclarations, compareMeasurements, comparePackages } from './packageComparison';

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

function advisory(id: string, aliases: string[] = []): PackageAdvisory {
  return {
    id,
    aliases,
    modified: '2026-09-18T00:00:00Z',
    url: `https://osv.dev/vulnerability/${id}`,
    detailsStatus: 'available',
  };
}
function vulnerabilities(
  advisories: PackageAdvisory[],
  status: 'available' | 'partial' = 'available',
): PackageVulnerabilities {
  return { status, count: advisories.length, advisories };
}

describe('local comparison boundaries', () => {
  it('distinguishes an explicit null export map from an absent declaration', () => {
    expect(comparePackages(version(), version({ moduleFormat: { exports: null } })).exports).toMatchObject({
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
    expect(comparePackages(from, to).dependencies).toEqual([
      { name: 'added', kind: 'added', from: null, to: { category: 'runtime', range: '*' } },
      { name: 'removed', kind: 'removed', from: { category: 'runtime', range: '*' }, to: null },
    ]);
  });

  it('retains nested type conditions and condition precedence', () => {
    const from = version({ moduleFormat: { exports: { '.': { import: { types: './a.d.ts', default: './a.js' } } } } });
    const to = version({ moduleFormat: { exports: { '.': { import: { default: './a.js', types: './a.d.ts' } } } } });
    expect(comparePackages(from, to)).toMatchObject({ exports: { changed: true }, types: { changed: true } });
    expect(comparePackages(from, from)).toMatchObject({ exports: { changed: false }, types: { changed: false } });
  });

  it('uses complete tarball inventories despite partial changelog text and handles a zero baseline', () => {
    const from = version({ dist: { tarball: '', unpackedSize: 0 } });
    const to = version({
      tarball: {
        status: 'partial',
        url: '',
        reasons: ['truncated changelog'],
        changelogs: [],
        files: [
          { path: 'a.js', type: 'file', size: 120, sha256: 'abc' },
          { path: 'link', type: 'symlink', size: 9, sha256: null, linkTarget: 'a.js' },
        ],
      },
    });
    expect(comparePackages(from, to).sizes.unpacked).toEqual({
      status: 'available',
      from: 0,
      to: 120,
      delta: 120,
      percent: null,
      reasons: [],
      sources: { from: 'registry', to: 'tarball' },
    });
    expect(comparePackages(to, version()).sizes.unpacked).toMatchObject({
      status: 'partial',
      from: 120,
      to: null,
      delta: null,
      percent: null,
    });
    expect(comparePackages(to, from).sizes.unpacked).toMatchObject({ delta: -120, percent: -100 });
  });

  it('keeps provider estimates separate and suppresses deltas for builds omitting dependencies', () => {
    const from = version({
      bundleSize: {
        status: 'available',
        provider: 'bundlephobia',
        url: '',
        name: 'example',
        version: '1.0.0',
        retrievedAt: '',
        size: 100,
        gzip: 50,
      },
    });
    const to = version({
      bundleSize: {
        ...from.bundleSize,
        status: 'available',
        name: 'example',
        version: '2.0.0',
        retrievedAt: '',
        size: 120,
        gzip: 40,
      },
    });
    expect(comparePackages(from, to).sizes.bundle).toMatchObject({
      minified: { delta: 20, percent: 20 },
      gzip: { delta: -10, percent: -20 },
    });
    expect(comparePackages(from, to).sizes.unpacked.delta).toBeNull();
    const incomplete = version({
      bundleSize: {
        ...to.bundleSize,
        status: 'available',
        name: 'example',
        version: '2.0.0',
        retrievedAt: '',
        size: 120,
        gzip: 40,
        ignoredMissingDependencies: ['native'],
      },
    });
    expect(comparePackages(from, incomplete).sizes.bundle.minified).toMatchObject({
      status: 'partial',
      from: 100,
      to: 120,
      delta: null,
      percent: null,
    });
  });

  it('groups aliases transitively while preserving old-only and target-only findings', () => {
    const old = advisory('OLD', ['CVE-1']);
    const bridge = advisory('BRIDGE', ['CVE-1', 'CVE-2']);
    const target = advisory('TARGET', ['CVE-2']);
    const result = comparePackages(
      version({ vulnerabilities: vulnerabilities([old, advisory('FIXED')]) }),
      version({ vulnerabilities: vulnerabilities([target, bridge, advisory('NEW')]) }),
    ).advisories;
    expect(result.status).toBe('available');
    expect(result.both).toEqual([
      { ids: ['BRIDGE', 'OLD', 'TARGET'], aliases: ['CVE-1', 'CVE-2'], from: [old], to: [bridge, target] },
    ]);
    expect(result.fromOnly.map((group) => group.ids)).toEqual([['FIXED']]);
    expect(result.toOnly.map((group) => group.ids)).toEqual([['NEW']]);
    expect(result.uncertain).toEqual([]);
  });

  it('does not classify absent advisories as resolved or introduced under incomplete coverage', () => {
    const old = version({ vulnerabilities: vulnerabilities([advisory('OLD')]) });
    const target = version({ vulnerabilities: vulnerabilities([advisory('NEW')], 'partial') });
    const result = comparePackages(old, target).advisories;
    expect(result).toMatchObject({ status: 'partial', fromOnly: [], toOnly: [], both: [] });
    expect(result.uncertain.map((group) => group.ids)).toEqual([['NEW'], ['OLD']]);
    expect(
      comparePackages(old, version({ vulnerabilities: { status: 'unavailable', count: null, advisories: [] } }))
        .advisories,
    ).toMatchObject({ status: 'partial', fromOnly: [], uncertain: [{ ids: ['OLD'] }] });
  });
});

describe('declaration and measurement split', () => {
  it('compares declarations from manifest fields without measurement evidence', () => {
    const declaredFrom = {
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
    const declaredTo = { ...declaredFrom, version: '2.0.0', engines: { node: '>=20' } };

    expect(compareDeclarations(declaredFrom, declaredTo)).toMatchObject({
      node: { changed: true, from: '>=18', to: '>=20' },
      dependencies: [],
      peers: [],
      installScripts: [],
    });
  });

  it('splits a combined comparison into its declaration and measurement halves', () => {
    const from = version();
    const to = version({ version: '2.0.0' });

    expect(comparePackages(from, to)).toEqual({
      ...compareDeclarations(from, to),
      ...compareMeasurements(from, to),
    });
  });
});
