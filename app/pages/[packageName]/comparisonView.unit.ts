import { describe, expect, it } from 'vitest';

import type {
  DeclarationComparison,
  DeclaredPackageVersion,
  MeasuredPackageVersion,
  MeasurementComparison,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
} from '#shared/comparison/comparison.defs';
import type { ParsedPackageVersion } from '#shared/comparison/package/package.defs';

import { buildComparisonRows, resolvedBriefingVersions } from './comparisonView';

const makeDeclaredVersion = (
  version: string,
  overrides: Partial<ParsedPackageVersion> = {},
): DeclaredPackageVersion => ({
  name: 'example-package',
  version,
  dist: {
    tarball: `https://registry.npmjs.org/example-package/-/example-package-${version}.tgz`,
    integrity: 'sha512-example',
    unpackedSize: 100,
    fileCount: 2,
  },
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
  ...overrides,
});

const makeMeasuredVersion = (
  version: string,
  overrides: Partial<MeasuredPackageVersion> = {},
): MeasuredPackageVersion => ({
  ...makeDeclaredVersion(version),
  bundledTypes: { status: 'available', matchedTargetCount: 0 },
  installAnalysis: { status: 'available', reasons: [], uninspectedPackages: [], scripts: [], findings: [] },
  vulnerabilities: { status: 'available', count: 0, advisories: [] },
  bundleSize: {
    provider: 'bundlephobia',
    url: `https://bundlephobia.com/api/size?package=example-package%40${version}`,
    name: 'example-package',
    version,
    size: 1000,
    gzip: 500,
    status: 'available',
    retrievedAt: '2026-09-20T00:00:00.000Z',
  },
  tarball: {
    status: 'available',
    reasons: [],
    url: `https://registry.npmjs.org/example-package/-/example-package-${version}.tgz`,
    fileCount: 0,
    changelogCount: 0,
  },
  ...overrides,
});

const declarationsComparison: DeclarationComparison = {
  dependencies: [],
  peers: [],
  node: { changed: false, from: '>=18', to: '>=18', fromDeclared: true, toDeclared: true },
  moduleFormat: {
    changed: false,
    from: { main: 'index.js' },
    to: { main: 'index.js' },
    fromDeclared: true,
    toDeclared: true,
  },
  exports: { changed: false, from: null, to: null, fromDeclared: false, toDeclared: false },
  types: { changed: false, from: { exports: null }, to: { exports: null }, fromDeclared: true, toDeclared: true },
  licenses: { changed: false, from: ['MIT'], to: ['MIT'], added: [], removed: [] },
  installScripts: [],
};

const measurementsComparison: MeasurementComparison = {
  installImplementation: { status: 'available', changedFiles: [] },
  sizes: {
    unpacked: {
      status: 'available',
      from: 100,
      to: 120,
      delta: 20,
      percent: 20,
      reasons: [],
      sources: { from: 'registry', to: 'registry' },
    },
    bundle: {
      provider: 'bundlephobia',
      methodology: 'provider-estimate',
      minified: { status: 'available', from: 1000, to: 1200, delta: 200, percent: 20, reasons: [] },
      gzip: { status: 'available', from: 500, to: 600, delta: 100, percent: 20, reasons: [] },
    },
  },
  advisories: {
    status: 'available',
    coverage: { from: 'available', to: 'available' },
    reasons: [],
    fromOnly: [],
    both: [],
    toOnly: [],
    uncertain: [],
  },
};

const declarationsFixture: PackageDeclarationsResponse = {
  packageName: 'example-package',
  from: makeDeclaredVersion('1.0.0'),
  to: makeDeclaredVersion('2.0.0'),
  comparison: declarationsComparison,
};

const measurementsFixture: PackageMeasurementsResponse = {
  packageName: 'example-package',
  from: makeMeasuredVersion('1.0.0'),
  to: makeMeasuredVersion('2.0.0', {
    bundleSize: {
      provider: 'bundlephobia',
      url: 'https://bundlephobia.com/api/size?package=example-package%402.0.0',
      name: 'example-package',
      version: '2.0.0',
      size: 1200,
      gzip: 600,
      status: 'available',
      retrievedAt: '2026-09-20T00:00:00.000Z',
    },
    tarball: {
      status: 'available',
      reasons: [],
      url: 'https://registry.npmjs.org/example-package/-/example-package-2.0.0.tgz',
      fileCount: 3,
      changelogCount: 1,
    },
  }),
  comparison: measurementsComparison,
};

describe('buildComparisonRows', () => {
  it('keeps unchanged categories visible and formats side-by-side size values', () => {
    const rows = buildComparisonRows(declarationsFixture, measurementsFixture);

    expect(rows.map((row) => row.id)).toContain('comparison-node');
    expect(rows.find((row) => row.id === 'comparison-node')).toMatchObject({
      from: '>=18',
      to: '>=18',
      changed: false,
    });
    expect(rows.find((row) => row.id === 'comparison-sizes-unpacked')).toMatchObject({
      from: '100 bytes',
      to: '120 bytes',
      detail: '+20 bytes (+20.0%)',
      changed: true,
    });
  });

  it('labels measurement rows as pending until the measurements tier resolves', () => {
    const rows = buildComparisonRows(declarationsFixture, undefined);

    expect(rows.map((row) => row.id)).toEqual([
      'comparison-dependencies',
      'comparison-peers',
      'comparison-node',
      'comparison-module-format',
      'comparison-exports',
      'comparison-types',
      'comparison-licenses',
      'comparison-install-scripts',
      'comparison-sizes-unpacked',
      'comparison-sizes-minified',
      'comparison-sizes-gzip',
      'comparison-advisories',
      'comparison-tarball',
    ]);
    expect(rows.slice(8).map((row) => [row.from, row.to])).toEqual(
      Array.from({ length: 5 }, () => ['Measuring…', 'Measuring…']),
    );
    expect(rows.slice(8).every((row) => row.changed === false)).toBe(true);
  });

  it('renders unavailable measurement rows after the measurements tier fails', () => {
    const rows = buildComparisonRows(declarationsFixture, undefined, true);

    expect(rows.slice(8).map((row) => row.id)).toEqual([
      'comparison-sizes-unpacked',
      'comparison-sizes-minified',
      'comparison-sizes-gzip',
      'comparison-advisories',
      'comparison-tarball',
    ]);
    expect(rows.slice(8).map((row) => [row.from, row.to])).toEqual(
      Array.from({ length: 5 }, () => ['Unavailable', 'Unavailable']),
    );
    expect(rows.slice(8).every((row) => row.changed === false && row.detail === '')).toBe(true);
  });

  it('fills measurement rows from the measurements tier', () => {
    const rows = buildComparisonRows(declarationsFixture, measurementsFixture);

    expect(rows.find((row) => row.id === 'comparison-sizes-gzip')).toMatchObject({ changed: true });
    expect(rows.find((row) => row.id === 'comparison-tarball')?.from).toContain('files');
  });
});

describe('resolvedBriefingVersions', () => {
  it('uses the declarations response versions and stays disabled before declarations resolve', () => {
    expect(resolvedBriefingVersions(undefined)).toEqual({ from: '', to: '' });
    expect(
      resolvedBriefingVersions({ from: makeDeclaredVersion('19.0.0'), to: makeDeclaredVersion('19.3.0') }),
    ).toEqual({
      from: '19.0.0',
      to: '19.3.0',
    });
  });
});
