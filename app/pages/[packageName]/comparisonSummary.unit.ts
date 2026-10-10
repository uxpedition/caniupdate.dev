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

import { buildComparisonSummaries } from './comparisonSummary';
import { buildComparisonRows } from './comparisonView';

const makeDeclaredVersion = (
  version: string,
  overrides: Partial<ParsedPackageVersion> = {},
): DeclaredPackageVersion => ({
  name: 'example-package',
  version,
  dist: { tarball: `https://registry.npmjs.org/example-${version}.tgz`, integrity: 'sha512-example' },
  licenses: ['MIT'],
  deprecated: false,
  engines: { node: '>=18' },
  dependencies: {},
  peerDependencies: {},
  optionalDependencies: {},
  optionalPeers: [],
  installScripts: [],
  installScriptCommands: {},
  moduleFormat: {},
  ...overrides,
});

const declarationComparison: DeclarationComparison = {
  dependencies: [],
  peers: [],
  node: { changed: false, from: '>=18', to: '>=18', fromDeclared: true, toDeclared: true },
  moduleFormat: {
    changed: false,
    from: {},
    to: {},
    fromDeclared: false,
    toDeclared: false,
  },
  exports: { changed: false, from: null, to: null, fromDeclared: false, toDeclared: false },
  types: { changed: false, from: { exports: null }, to: { exports: null }, fromDeclared: false, toDeclared: false },
  licenses: { changed: false, from: ['MIT'], to: ['MIT'], added: [], removed: [] },
  installScripts: [],
};

const declarations: PackageDeclarationsResponse = {
  packageName: 'example-package',
  from: makeDeclaredVersion('1.0.0'),
  to: makeDeclaredVersion('2.0.0'),
  comparison: declarationComparison,
};

const unavailableDeclarations: PackageDeclarationsResponse = {
  ...declarations,
  from: makeDeclaredVersion('1.0.0', { dependencies: {} }),
  to: makeDeclaredVersion('2.0.0', { dependencies: { added: '^1.0.0' }, engines: { node: '>=20' } }),
  comparison: {
    ...declarationComparison,
    dependencies: [{ name: 'added', kind: 'added', from: null, to: { category: 'runtime', range: '^1.0.0' } }],
    node: { changed: true, from: '>=18', to: '>=20', fromDeclared: true, toDeclared: true },
  },
};

const makeMeasuredVersion = (version: string, omitted: string[] = []): MeasuredPackageVersion => ({
  ...makeDeclaredVersion(version),
  vulnerabilities: { status: 'available', count: 0, advisories: [] },
  bundleSize: {
    provider: 'bundlephobia',
    url: `https://bundlephobia.com/api/size?package=example-package%40${version}`,
    name: 'example-package',
    version,
    size: version === '1.0.0' ? 1000 : 1300,
    gzip: version === '1.0.0' ? 500 : 650,
    status: 'available',
    retrievedAt: '2026-09-20T00:00:00.000Z',
    ...(omitted.length === 0 ? {} : { ignoredMissingDependencies: omitted }),
  },
  tarball: {
    status: 'available',
    reasons: [],
    url: `https://registry.npmjs.org/example-${version}.tgz`,
    fileCount: version === '1.0.0' ? 2 : 3,
    changelogCount: 0,
  },
});

const measurementComparison: MeasurementComparison = {
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
      minified: { status: 'available', from: 1000, to: 1300, delta: 300, percent: 30, reasons: [] },
      gzip: { status: 'available', from: 500, to: 650, delta: 150, percent: 30, reasons: [] },
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

const measurements: PackageMeasurementsResponse = {
  packageName: 'example-package',
  from: makeMeasuredVersion('1.0.0'),
  to: makeMeasuredVersion('2.0.0', ['optional-native']),
  comparison: measurementComparison,
};

describe('buildComparisonSummaries', () => {
  it('keeps pending measurement rows collapsed with an explicit measuring value', () => {
    const rows = buildComparisonRows(declarations, undefined);

    const summaries = buildComparisonSummaries(
      { declarations, measurements: undefined, measurementsUnavailable: false },
      rows,
    );

    const pending = summaries.filter(
      ({ row }) =>
        row.sourceId.startsWith('comparison.sizes') ||
        row.sourceId === 'comparison.advisories' ||
        row.sourceId === 'comparison.tarball',
    );

    expect(pending).toHaveLength(5);
    expect(
      pending.every(
        ({ from, to, changed, expandable }) => from === 'Measuring…' && to === 'Measuring…' && !changed && !expandable,
      ),
    ).toBe(true);
  });

  it('shows readable measurement deltas and incomplete estimate notes only for bundle rows', () => {
    const rows = buildComparisonRows(declarations, measurements);
    const summaries = buildComparisonSummaries({ declarations, measurements, measurementsUnavailable: false }, rows);
    const gzip = summaries.find(({ row }) => row.sourceId === 'comparison.sizes-gzip');
    const unpacked = summaries.find(({ row }) => row.sourceId === 'comparison.sizes-unpacked');
    const minified = summaries.find(({ row }) => row.sourceId === 'comparison.sizes-minified');

    expect(gzip).toMatchObject({
      from: '500 B',
      to: '650 B',
      note: '+150 B (+30%)',
      fromNote: '',
      toNote: 'Incomplete estimate',
    });
    expect(unpacked).toMatchObject({ from: '100 B', to: '120 B', note: '+20 B (+20%)', fromNote: '', toNote: '' });
    expect(minified).toMatchObject({ from: '1 kB', to: '1.3 kB', fromNote: '', toNote: 'Incomplete estimate' });
  });

  it('collapses measurement rows as unavailable without hiding declaration changes', () => {
    const rows = buildComparisonRows(unavailableDeclarations, undefined, true);

    const summaries = buildComparisonSummaries(
      { declarations: unavailableDeclarations, measurements: undefined, measurementsUnavailable: true },
      rows,
    );

    const unavailable = summaries.filter(
      ({ row }) =>
        row.sourceId.startsWith('comparison.sizes') ||
        row.sourceId === 'comparison.advisories' ||
        row.sourceId === 'comparison.tarball',
    );

    const changedDeclaration = summaries.find(({ row }) => row.sourceId === 'comparison.dependencies');
    const unchangedDeclaration = summaries.find(({ row }) => row.sourceId === 'comparison.moduleFormat');

    expect(unavailable).toHaveLength(5);
    expect(
      unavailable.every(
        ({ from, to, changed, note, expandable }) =>
          from === 'Unavailable' && to === 'Unavailable' && !changed && note === '' && !expandable,
      ),
    ).toBe(true);
    expect(changedDeclaration).toMatchObject({
      from: 'None declared',
      to: '1 dependencies',
      changed: true,
      note: '1 declaration changes',
      showNote: true,
      expandable: true,
    });
    expect(unchangedDeclaration).toMatchObject({
      from: 'None declared',
      to: 'None declared',
      changed: false,
      expandable: false,
    });
  });
});
