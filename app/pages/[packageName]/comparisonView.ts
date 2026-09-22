import type { BriefingBullet, BriefingSource } from '#shared/briefing.defs';
import type {
  DeclarationComparison,
  DeclaredPackageVersion,
  MeasuredPackageVersion,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
  SizeComparison,
} from '#shared/comparison.defs';

export type ComparisonRow = {
  id: string;
  sourceId: string;
  label: string;
  from: string;
  to: string;
  changed: boolean;
  detail: string;
  explanation: string;
};

export type BriefingCitation = {
  number: number;
  id: string;
  anchorId: string;
  label: string;
  urls: readonly string[];
};

const EMPTY_VALUE = 'None declared';

const formatNumber = (value: number): string => new Intl.NumberFormat('en-US').format(value);

const formatBytes = (value: number | null): string => (value === null ? 'Unavailable' : `${formatNumber(value)} bytes`);

const formatJson = (value: unknown): string => {
  if (value === null || value === undefined) return 'Not declared';
  return JSON.stringify(value, null, 2) ?? 'Not declared';
};

const formatEntries = (entries: readonly string[]): string => (entries.length === 0 ? EMPTY_VALUE : entries.join('\n'));

const formatRequirements = (version: DeclaredPackageVersion): string => {
  const requirements = new Map<string, string>();
  for (const [name, range] of Object.entries(version.dependencies)) requirements.set(name, range);
  for (const [name, range] of Object.entries(version.optionalDependencies))
    requirements.set(name, `${range} · optional`);

  return formatEntries(
    [...requirements.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, range]) => `${name}: ${range}`),
  );
};

const formatPeers = (version: DeclaredPackageVersion): string => {
  const optionalPeers = new Set(version.optionalPeers);
  return formatEntries(
    Object.entries(version.peerDependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, range]) => `${name}: ${range}${optionalPeers.has(name) ? ' · optional' : ''}`),
  );
};

const formatModule = (version: DeclaredPackageVersion): string => {
  const values = Object.entries({
    type: version.moduleFormat.type,
    main: version.moduleFormat.main,
    module: version.moduleFormat.module,
  })
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}: ${value}`);

  return formatEntries(values);
};

const formatTypes = (version: DeclaredPackageVersion): string => {
  const values: string[] = [];
  if (version.moduleFormat.types !== undefined) values.push(`types: ${version.moduleFormat.types}`);
  if (version.moduleFormat.typings !== undefined) values.push(`typings: ${version.moduleFormat.typings}`);
  if (version.moduleFormat.typesVersions !== undefined)
    values.push(`typesVersions:\n${formatJson(version.moduleFormat.typesVersions)}`);
  return formatEntries(values);
};

const formatScripts = (version: DeclaredPackageVersion): string =>
  formatEntries(
    Object.entries(version.installScriptCommands)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, command]) => `${name}: ${command}`),
  );

const formatAdvisories = (version: MeasuredPackageVersion): string => {
  const { status, count } = version.vulnerabilities;
  const countLabel = count === null ? 'count unavailable' : `${count} ${count === 1 ? 'advisory' : 'advisories'}`;
  return `${countLabel} · coverage ${status}`;
};

const formatTarball = (version: MeasuredPackageVersion): string => {
  const changelogLabel = version.tarball.changelogCount === 0 ? 'no shipped changelog' : 'shipped changelog';
  return `${version.tarball.status} · ${formatNumber(version.tarball.fileCount)} files · ${changelogLabel}`;
};

const formatDelta = (size: SizeComparison): string => {
  if (size.delta === null) {
    if (size.from === null || size.to === null) return 'A size comparison needs a measurement for both versions.';
    return 'Bundlephobia omitted dependencies from at least one build. The size difference would not be a like-for-like comparison.';
  }

  const sign = size.delta > 0 ? '+' : '';
  const percentage = size.percent === null ? '' : ` (${size.percent > 0 ? '+' : ''}${size.percent.toFixed(1)}%)`;
  const reasons = size.reasons.length === 0 ? '' : ` · ${size.reasons.join('; ')}`;
  return `${sign}${formatNumber(size.delta)} bytes${percentage}${reasons}`;
};

const rowExplanations = {
  'comparison.dependencies':
    'Runtime and optional dependencies declared by the package. Changes here compare version ranges, not the exact versions installed in your project.',
  'comparison.peers':
    'Packages expected from your project, with their supported version ranges. Optional peers are marked in the details.',
  'comparison.node':
    'The Node.js versions this package declares it supports. No declaration does not guarantee compatibility with every Node.js version.',
  'comparison.moduleFormat':
    'How the package declares its JavaScript module format and entry points. These declarations help tools choose between ESM and CommonJS.',
  'comparison.exports':
    'The public import paths and conditions declared in package.json. Changes can affect which files your application can import.',
  'comparison.types':
    'TypeScript declaration entry points and version mappings declared in package.json. This does not compare the types themselves.',
  'comparison.licenses':
    'License identifiers declared in the published package metadata. Review the license terms before deciding whether they fit your project.',
  'comparison.installScripts':
    'Lifecycle scripts that may run during installation, depending on your package manager and settings. Expand to inspect the commands.',
  'comparison.sizes-unpacked':
    'The total size of the published package files before compression. Dependencies are not included. This is not your application bundle size.',
  'comparison.sizes-minified':
    'Bundlephobia’s minified build of the package and its bundled dependencies. Your application may include different code. Builds with omitted dependencies are not comparable.',
  'comparison.sizes-gzip':
    'The gzip-compressed size of Bundlephobia’s minified build, not its installed size or your application’s download size. Builds with omitted dependencies are not comparable.',
  'comparison.advisories':
    'Known security advisories matched by OSV for each version. No matches is not a guarantee of safety, and incomplete coverage cannot establish that an issue was fixed.',
  'comparison.tarball':
    'Evidence from inspecting the published npm archive, including file count and shipped changelogs. Availability indicates inspection coverage, not a security or provenance guarantee.',
};

const row = (
  sourceId: keyof typeof rowExplanations,
  label: string,
  from: string,
  to: string,
  changed: boolean,
  detail = '',
): ComparisonRow => ({
  id: citationAnchorId(sourceId),
  sourceId,
  label,
  from,
  to,
  changed,
  detail,
  explanation: rowExplanations[sourceId],
});

const packageDeclarationRows = (
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  comparison: DeclarationComparison,
): readonly ComparisonRow[] => [
  row(
    'comparison.dependencies',
    'Dependencies',
    formatRequirements(from),
    formatRequirements(to),
    comparison.dependencies.length > 0,
    comparison.dependencies.length > 0
      ? `${comparison.dependencies.length} declaration changes`
      : 'No declaration changes',
  ),
  row(
    'comparison.peers',
    'Peer dependencies',
    formatPeers(from),
    formatPeers(to),
    comparison.peers.length > 0,
    comparison.peers.length > 0 ? `${comparison.peers.length} declaration changes` : 'No declaration changes',
  ),
  row(
    'comparison.node',
    'Node engine',
    from.engines.node ?? 'Not declared',
    to.engines.node ?? 'Not declared',
    comparison.node.changed,
  ),
];

const moduleDeclarationRows = (
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  comparison: DeclarationComparison,
): readonly ComparisonRow[] => [
  row(
    'comparison.moduleFormat',
    'Module format',
    formatModule(from),
    formatModule(to),
    comparison.moduleFormat.changed,
  ),
  row(
    'comparison.exports',
    'Exports',
    formatJson(from.moduleFormat.exports),
    formatJson(to.moduleFormat.exports),
    comparison.exports.changed,
  ),
  row('comparison.types', 'Type declarations', formatTypes(from), formatTypes(to), comparison.types.changed),
  row(
    'comparison.licenses',
    'Licenses',
    formatEntries([...from.licenses]),
    formatEntries([...to.licenses]),
    comparison.licenses.changed,
  ),
  row(
    'comparison.installScripts',
    'Install scripts',
    formatScripts(from),
    formatScripts(to),
    comparison.installScripts.length > 0,
    comparison.installScripts.length > 0
      ? `${comparison.installScripts.length} script changes`
      : 'No lifecycle scripts',
  ),
];

const declarationRows = (
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  comparison: DeclarationComparison,
): readonly ComparisonRow[] => [
  ...packageDeclarationRows(from, to, comparison),
  ...moduleDeclarationRows(from, to, comparison),
];

const formatBundleSize = (bytes: number | null, version: MeasuredPackageVersion): string => {
  const build = version.bundleSize;
  const omitted = build.status === 'available' ? build.ignoredMissingDependencies : undefined;
  return omitted?.length
    ? `${formatBytes(bytes)}\nIncomplete estimate. Bundlephobia omitted:\n${omitted.join('\n')}`
    : formatBytes(bytes);
};

export const MEASUREMENT_SOURCE_IDS: readonly string[] = [
  'comparison.sizes-unpacked',
  'comparison.sizes-minified',
  'comparison.sizes-gzip',
  'comparison.advisories',
  'comparison.tarball',
];
export const MEASURING_VALUE = 'Measuring…';
export const MEASUREMENTS_UNAVAILABLE_VALUE = 'Unavailable';

const measured = (
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable: boolean,
  read: (value: PackageMeasurementsResponse) => string,
) =>
  measurementsUnavailable
    ? MEASUREMENTS_UNAVAILABLE_VALUE
    : measurements === undefined
      ? MEASURING_VALUE
      : read(measurements);

const measurementChanged = (measurementsUnavailable: boolean, changed: boolean): boolean =>
  !measurementsUnavailable && changed;

const measurementDetail = (
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable: boolean,
  read: (value: PackageMeasurementsResponse) => string,
): string => (measurementsUnavailable || measurements === undefined ? '' : read(measurements));

const measurementSizeRows = (
  measurements: PackageMeasurementsResponse | undefined,
  sizes: PackageMeasurementsResponse['comparison']['sizes'] | undefined,
  measurementsUnavailable: boolean,
): readonly ComparisonRow[] => [
  row(
    'comparison.sizes-unpacked',
    'Unpacked package size',
    measured(measurements, measurementsUnavailable, (value) => formatBytes(value.comparison.sizes.unpacked.from)),
    measured(measurements, measurementsUnavailable, (value) => formatBytes(value.comparison.sizes.unpacked.to)),
    measurementChanged(measurementsUnavailable, sizes !== undefined && sizes.unpacked.delta !== 0),
    measurementDetail(measurements, measurementsUnavailable, (value) => formatDelta(value.comparison.sizes.unpacked)),
  ),
  row(
    'comparison.sizes-minified',
    'Estimated minified bundle',
    measured(measurements, measurementsUnavailable, (value) =>
      formatBundleSize(value.comparison.sizes.bundle.minified.from, value.from),
    ),
    measured(measurements, measurementsUnavailable, (value) =>
      formatBundleSize(value.comparison.sizes.bundle.minified.to, value.to),
    ),
    measurementChanged(measurementsUnavailable, sizes !== undefined && sizes.bundle.minified.delta !== 0),
    measurementDetail(
      measurements,
      measurementsUnavailable,
      (value) => `${formatDelta(value.comparison.sizes.bundle.minified)} · provider estimate`,
    ),
  ),
  row(
    'comparison.sizes-gzip',
    'Estimated gzip bundle',
    measured(measurements, measurementsUnavailable, (value) =>
      formatBundleSize(value.comparison.sizes.bundle.gzip.from, value.from),
    ),
    measured(measurements, measurementsUnavailable, (value) =>
      formatBundleSize(value.comparison.sizes.bundle.gzip.to, value.to),
    ),
    measurementChanged(measurementsUnavailable, sizes !== undefined && sizes.bundle.gzip.delta !== 0),
    measurementDetail(
      measurements,
      measurementsUnavailable,
      (value) => `${formatDelta(value.comparison.sizes.bundle.gzip)} · provider estimate`,
    ),
  ),
];

const measurementAdvisoryRow = (
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable: boolean,
): ComparisonRow =>
  row(
    'comparison.advisories',
    'Security advisories',
    measured(measurements, measurementsUnavailable, (value) => formatAdvisories(value.from)),
    measured(measurements, measurementsUnavailable, (value) => formatAdvisories(value.to)),
    measurementChanged(
      measurementsUnavailable,
      measurements !== undefined &&
        (measurements.comparison.advisories.fromOnly.length > 0 ||
          measurements.comparison.advisories.toOnly.length > 0 ||
          measurements.comparison.advisories.uncertain.length > 0),
    ),
    measurementDetail(measurements, measurementsUnavailable, (value) =>
      value.comparison.advisories.status === 'available'
        ? 'Coverage available'
        : `Coverage ${value.comparison.advisories.status}`,
    ),
  );

const measurementTarballRow = (
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable: boolean,
): ComparisonRow =>
  row(
    'comparison.tarball',
    'Published tarball',
    measured(measurements, measurementsUnavailable, (value) => formatTarball(value.from)),
    measured(measurements, measurementsUnavailable, (value) => formatTarball(value.to)),
    measurementChanged(
      measurementsUnavailable,
      measurements !== undefined && measurements.from.tarball.status !== measurements.to.tarball.status,
    ),
  );

const measurementRows = (
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable: boolean,
): readonly ComparisonRow[] => [
  ...measurementSizeRows(measurements, measurements?.comparison.sizes, measurementsUnavailable),
  measurementAdvisoryRow(measurements, measurementsUnavailable),
  measurementTarballRow(measurements, measurementsUnavailable),
];

export function buildComparisonRows(
  declarations: PackageDeclarationsResponse,
  measurements: PackageMeasurementsResponse | undefined,
  measurementsUnavailable = false,
): readonly ComparisonRow[] {
  return [
    ...declarationRows(declarations.from, declarations.to, declarations.comparison),
    ...measurementRows(measurements, measurementsUnavailable),
  ];
}

export function resolvedBriefingVersions(
  comparison: { from: { version: string }; to: { version: string } } | undefined,
): { from: string; to: string } {
  return comparison === undefined ? { from: '', to: '' } : { from: comparison.from.version, to: comparison.to.version };
}

export function citationAnchorId(sourceId: string): string {
  const normalized = sourceId
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sourceId.startsWith('comparison.') ? normalized : `evidence-${normalized}`;
}

export function buildBriefingCitations(
  sources: readonly BriefingSource[],
  bullets: readonly BriefingBullet[],
): readonly BriefingCitation[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const citations: BriefingCitation[] = [];

  for (const bullet of bullets) {
    for (const id of bullet.evidenceIds) {
      const source = sourcesById.get(id);
      if (source === undefined || seen.has(id)) continue;
      seen.add(id);
      citations.push({
        number: citations.length + 1,
        id: source.id,
        anchorId: citationAnchorId(source.id),
        label: source.label,
        urls: source.urls,
      });
    }
  }

  return citations;
}
