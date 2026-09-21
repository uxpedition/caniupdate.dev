import type { BriefingInput } from '#shared/briefing.defs';
import type { ComparisonVersion, SizeComparison } from '#shared/comparison.defs';
import type { ComparisonRow } from '~/pages/[packageName]/comparisonView';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function readableSize(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes < 1000) return `${number.format(bytes)} B`;
  if (bytes < 1_000_000) return `${number.format(bytes / 1000)} kB`;
  return `${number.format(bytes / 1_000_000)} MB`;
}

export function sizeChange(size: SizeComparison): string {
  if (size.delta === null) return 'Comparison unavailable';
  if (size.delta === 0) return 'No size change';
  const sign = size.delta > 0 ? '+' : '−';
  const percent = size.percent === null ? '' : ` (${sign}${number.format(Math.abs(size.percent))}%)`;
  return `${sign}${readableSize(Math.abs(size.delta))}${percent}`;
}

const declarationSummaries: Record<string, (version: ComparisonVersion) => string> = {
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

function evidenceSummary(version: ComparisonVersion, sourceId: string, original: string): string {
  if (sourceId === 'comparison.advisories') {
    const { count, status } = version.vulnerabilities;
    if (count === null) return 'Coverage unavailable';
    return `${count} matched${status === 'available' ? '' : ' · partial coverage'}`;
  }
  if (sourceId === 'comparison.tarball') {
    const { status, files } = version.tarball;
    return status === 'unavailable'
      ? 'Unavailable'
      : `${files.length} files${status === 'available' ? '' : ' · partial coverage'}`;
  }
  return declarationSummaries[sourceId]?.(version) ?? original;
}

function rowPresentation(row: ComparisonRow, data: BriefingInput, size: SizeComparison | undefined) {
  if (size)
    return {
      from: readableSize(size.from),
      to: readableSize(size.to),
      changed: size.delta !== null && size.delta !== 0,
      note: sizeChange(size),
    };
  return {
    from: evidenceSummary(data.from, row.sourceId, row.from),
    to: evidenceSummary(data.to, row.sourceId, row.to),
    changed: row.changed,
    note: row.changed ? row.detail || 'Declaration changed' : '',
  };
}

export function buildComparisonSummaries(data: BriefingInput, rows: readonly ComparisonRow[]) {
  const sizes: Record<string, SizeComparison> = {
    'comparison.sizes-unpacked': data.comparison.sizes.unpacked,
    'comparison.sizes-minified': data.comparison.sizes.bundle.minified,
    'comparison.sizes-gzip': data.comparison.sizes.bundle.gzip,
  };
  return rows.map((row) => {
    const presentation = rowPresentation(row, data, sizes[row.sourceId]);
    return {
      row,
      ...presentation,
      anchor: row.sourceId === 'comparison.sizes-unpacked' ? 'comparison-sizes' : row.id,
      expandable:
        presentation.from !== row.from ||
        presentation.to !== row.to ||
        row.detail.length > 0 ||
        row.from.includes('\n') ||
        row.to.includes('\n'),
    };
  });
}
