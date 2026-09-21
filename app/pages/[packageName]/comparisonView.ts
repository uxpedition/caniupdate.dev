import type { BriefingBullet, BriefingSource } from '#shared/briefing.defs';
import type { ComparisonVersion, PackageComparison, SizeComparison } from '#shared/comparison.defs';

export type ComparisonRow = {
  id: string;
  sourceId: string;
  label: string;
  from: string;
  to: string;
  changed: boolean;
  detail: string;
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

const formatRequirements = (version: ComparisonVersion): string => {
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

const formatPeers = (version: ComparisonVersion): string => {
  const optionalPeers = new Set(version.optionalPeers);
  return formatEntries(
    Object.entries(version.peerDependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, range]) => `${name}: ${range}${optionalPeers.has(name) ? ' · optional' : ''}`),
  );
};

const formatModule = (version: ComparisonVersion): string => {
  const values = Object.entries({
    type: version.moduleFormat.type,
    main: version.moduleFormat.main,
    module: version.moduleFormat.module,
  })
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}: ${value}`);

  return formatEntries(values);
};

const formatTypes = (version: ComparisonVersion): string => {
  const values: string[] = [];
  if (version.moduleFormat.types !== undefined) values.push(`types: ${version.moduleFormat.types}`);
  if (version.moduleFormat.typings !== undefined) values.push(`typings: ${version.moduleFormat.typings}`);
  if (version.moduleFormat.typesVersions !== undefined)
    values.push(`typesVersions:\n${formatJson(version.moduleFormat.typesVersions)}`);
  return formatEntries(values);
};

const formatScripts = (version: ComparisonVersion): string =>
  formatEntries(
    Object.entries(version.installScriptCommands)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, command]) => `${name}: ${command}`),
  );

const formatAdvisories = (version: ComparisonVersion): string => {
  const { status, count } = version.vulnerabilities;
  const countLabel = count === null ? 'count unavailable' : `${count} ${count === 1 ? 'advisory' : 'advisories'}`;
  return `${countLabel} · coverage ${status}`;
};

const formatTarball = (version: ComparisonVersion): string => {
  const changelogLabel = version.tarball.changelogs.length === 0 ? 'no shipped changelog' : 'shipped changelog';
  return `${version.tarball.status} · ${formatNumber(version.tarball.files.length)} files · ${changelogLabel}`;
};

const formatDelta = (size: SizeComparison): string => {
  if (size.delta === null) return size.status === 'available' ? 'No delta available' : `Coverage ${size.status}`;

  const sign = size.delta > 0 ? '+' : '';
  const percentage = size.percent === null ? '' : ` (${size.percent > 0 ? '+' : ''}${size.percent.toFixed(1)}%)`;
  const reasons = size.reasons.length === 0 ? '' : ` · ${size.reasons.join('; ')}`;
  return `${sign}${formatNumber(size.delta)} bytes${percentage}${reasons}`;
};

const row = (
  sourceId: string,
  label: string,
  from: string,
  to: string,
  changed: boolean,
  detail = '',
): ComparisonRow => ({ id: citationAnchorId(sourceId), sourceId, label, from, to, changed, detail });

const packageDeclarationRows = (
  from: ComparisonVersion,
  to: ComparisonVersion,
  comparison: PackageComparison,
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
  from: ComparisonVersion,
  to: ComparisonVersion,
  comparison: PackageComparison,
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
  from: ComparisonVersion,
  to: ComparisonVersion,
  comparison: PackageComparison,
): readonly ComparisonRow[] => [
  ...packageDeclarationRows(from, to, comparison),
  ...moduleDeclarationRows(from, to, comparison),
];

const sizeRows = (comparison: PackageComparison): readonly ComparisonRow[] => [
  row(
    'comparison.sizes-unpacked',
    'Unpacked package size',
    formatBytes(comparison.sizes.unpacked.from),
    formatBytes(comparison.sizes.unpacked.to),
    comparison.sizes.unpacked.delta !== 0,
    formatDelta(comparison.sizes.unpacked),
  ),
  row(
    'comparison.sizes-minified',
    'Estimated minified bundle',
    formatBytes(comparison.sizes.bundle.minified.from),
    formatBytes(comparison.sizes.bundle.minified.to),
    comparison.sizes.bundle.minified.delta !== 0,
    `${formatDelta(comparison.sizes.bundle.minified)} · provider estimate`,
  ),
  row(
    'comparison.sizes-gzip',
    'Estimated gzip bundle',
    formatBytes(comparison.sizes.bundle.gzip.from),
    formatBytes(comparison.sizes.bundle.gzip.to),
    comparison.sizes.bundle.gzip.delta !== 0,
    `${formatDelta(comparison.sizes.bundle.gzip)} · provider estimate`,
  ),
];

const evidenceRows = (
  from: ComparisonVersion,
  to: ComparisonVersion,
  comparison: PackageComparison,
): readonly ComparisonRow[] => [
  row(
    'comparison.advisories',
    'Security advisories',
    formatAdvisories(from),
    formatAdvisories(to),
    comparison.advisories.fromOnly.length > 0 ||
      comparison.advisories.toOnly.length > 0 ||
      comparison.advisories.uncertain.length > 0,
    comparison.advisories.status === 'available' ? 'Coverage available' : `Coverage ${comparison.advisories.status}`,
  ),
  row(
    'comparison.tarball',
    'Published tarball',
    formatTarball(from),
    formatTarball(to),
    from.tarball.status !== to.tarball.status,
  ),
];

export function buildComparisonRows(
  from: ComparisonVersion,
  to: ComparisonVersion,
  comparison: PackageComparison,
): readonly ComparisonRow[] {
  return [...declarationRows(from, to, comparison), ...sizeRows(comparison), ...evidenceRows(from, to, comparison)];
}

export function resolvedBriefingVersions(comparison: { from: ComparisonVersion; to: ComparisonVersion } | undefined): {
  from: string;
  to: string;
} {
  return comparison === undefined ? { from: '', to: '' } : { from: comparison.from.version, to: comparison.to.version };
}

export function citationAnchorId(sourceId: string): string {
  const normalized = sourceId
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
