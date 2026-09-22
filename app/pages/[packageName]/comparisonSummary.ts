import type {
  DeclaredPackageVersion,
  MeasuredPackageVersion,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
  SizeComparison,
} from '#shared/comparison.defs';
import type { ComparisonRow } from '~/pages/[packageName]/comparisonView';

import { MEASURING_VALUE } from './comparisonView';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function readableSize(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes < 1000) return `${number.format(bytes)} B`;
  if (bytes < 1_000_000) return `${number.format(bytes / 1000)} kB`;
  return `${number.format(bytes / 1_000_000)} MB`;
}

export function sizeChange(size: SizeComparison): string {
  if (size.from === null && size.to === null) return 'Sizes unavailable';
  if (size.from === null || size.to === null) return 'Size missing for one version';
  if (size.delta === null) return 'Not comparable: incomplete build';
  if (size.delta === 0) return 'No size change';
  const sign = size.delta > 0 ? '+' : '−';
  const percent = size.percent === null ? '' : ` (${sign}${number.format(Math.abs(size.percent))}%)`;
  return `${sign}${readableSize(Math.abs(size.delta))}${percent}`;
}

const declarationSummaries: Record<string, (version: DeclaredPackageVersion) => string> = {
  'comparison.dependencies': (version) => {
    const count = new Set([...Object.keys(version.dependencies), ...Object.keys(version.optionalDependencies)]).size;
    return count === 0 ? 'None declared' : `${count} dependencies`;
  },
  'comparison.peers': (version) => {
    const count = Object.keys(version.peerDependencies).length;
    return count === 0 ? 'None declared' : `${count} ${count === 1 ? 'peer' : 'peers'}`;
  },
  'comparison.moduleFormat': (version) =>
    [
      version.moduleFormat.type,
      version.moduleFormat.main ? 'main entry' : '',
      version.moduleFormat.module ? 'module entry' : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'None declared',
  'comparison.exports': (version) =>
    version.moduleFormat.exports === undefined || version.moduleFormat.exports === null ? 'Not declared' : 'Declared',
  'comparison.types': (version) => {
    if (version.moduleFormat.types || version.moduleFormat.typings) return 'Types entry declared';
    return version.moduleFormat.typesVersions ? 'Versioned types declared' : 'None declared';
  },
  'comparison.installScripts': (version) => {
    const count = Object.keys(version.installScriptCommands).length;
    return count === 0 ? 'None declared' : `${count} install ${count === 1 ? 'script' : 'scripts'}`;
  },
};

const isMeasuredVersion = (
  version: MeasuredPackageVersion | DeclaredPackageVersion,
): version is MeasuredPackageVersion => 'vulnerabilities' in version;

function advisorySummary(version: MeasuredPackageVersion | DeclaredPackageVersion, original: string): string {
  if (!isMeasuredVersion(version)) return original;
  const { count, status } = version.vulnerabilities;
  if (count === null) return 'Coverage unavailable';
  return `${count} matched${status === 'available' ? '' : ' · partial coverage'}`;
}

function tarballSummary(version: MeasuredPackageVersion | DeclaredPackageVersion, original: string): string {
  if (!isMeasuredVersion(version)) return original;
  const { status, fileCount } = version.tarball;
  return status === 'unavailable'
    ? 'Unavailable'
    : `${fileCount} files${status === 'available' ? '' : ' · partial coverage'}`;
}

function evidenceSummary(
  version: MeasuredPackageVersion | DeclaredPackageVersion,
  sourceId: string,
  original: string,
): string {
  if (sourceId === 'comparison.advisories') return advisorySummary(version, original);
  if (sourceId === 'comparison.tarball') return tarballSummary(version, original);
  const declarationVersion: DeclaredPackageVersion = version;
  return declarationSummaries[sourceId]?.(declarationVersion) ?? original;
}

export type ComparisonSummaryInput = {
  declarations: PackageDeclarationsResponse;
  measurements: PackageMeasurementsResponse | undefined;
};

function rowPresentation(row: ComparisonRow, input: ComparisonSummaryInput, size: SizeComparison | undefined) {
  if (size)
    return {
      from: readableSize(size.from),
      to: readableSize(size.to),
      changed: size.delta !== null && size.delta !== 0,
      note: sizeChange(size),
      showNote: size.delta !== 0,
    };

  const versions =
    input.measurements !== undefined &&
    (row.sourceId === 'comparison.advisories' || row.sourceId === 'comparison.tarball')
      ? input.measurements
      : input.declarations;
  return {
    from: evidenceSummary(versions.from, row.sourceId, row.from),
    to: evidenceSummary(versions.to, row.sourceId, row.to),
    changed: row.changed,
    note: row.changed ? row.detail || 'Declaration changed' : '',
    showNote: row.changed,
  };
}

function incompleteEstimate(version: MeasuredPackageVersion): string {
  return version.bundleSize.status === 'available' && version.bundleSize.ignoredMissingDependencies?.length
    ? 'Incomplete estimate'
    : '';
}

const measurementSizes = (measurements: PackageMeasurementsResponse | undefined): Record<string, SizeComparison> =>
  measurements === undefined
    ? {}
    : {
        'comparison.sizes-unpacked': measurements.comparison.sizes.unpacked,
        'comparison.sizes-minified': measurements.comparison.sizes.bundle.minified,
        'comparison.sizes-gzip': measurements.comparison.sizes.bundle.gzip,
      };

const rowPresentationWithPending = (
  row: ComparisonRow,
  input: ComparisonSummaryInput,
  size: SizeComparison | undefined,
) =>
  row.from === MEASURING_VALUE && row.to === MEASURING_VALUE
    ? { from: MEASURING_VALUE, to: MEASURING_VALUE, changed: false, note: '', showNote: false }
    : rowPresentation(row, input, size);

const isBundleRow = (row: ComparisonRow): boolean =>
  row.sourceId === 'comparison.sizes-minified' || row.sourceId === 'comparison.sizes-gzip';

const estimateNotes = (row: ComparisonRow, measurements: PackageMeasurementsResponse | undefined) => {
  if (!isBundleRow(row) || measurements === undefined) return { fromNote: '', toNote: '' };
  return {
    fromNote: incompleteEstimate(measurements.from),
    toNote: incompleteEstimate(measurements.to),
  };
};

const summaryAnchor = (row: ComparisonRow): string =>
  row.sourceId === 'comparison.sizes-unpacked' ? 'comparison-sizes' : row.id;

const isExpandable = (row: ComparisonRow, presentation: { from: string; to: string }): boolean =>
  presentation.from !== row.from ||
  presentation.to !== row.to ||
  row.detail.length > 0 ||
  row.from.includes('\n') ||
  row.to.includes('\n');

export function buildComparisonSummaries(input: ComparisonSummaryInput, rows: readonly ComparisonRow[]) {
  const sizes = measurementSizes(input.measurements);
  return rows.map((row) => {
    const presentation = rowPresentationWithPending(row, input, sizes[row.sourceId]);
    return {
      row,
      ...presentation,
      ...estimateNotes(row, input.measurements),
      anchor: summaryAnchor(row),
      expandable: isExpandable(row, presentation),
    };
  });
}
