import type {
  DeclaredPackageVersion,
  MeasuredPackageVersion,
  PackageMeasurementsResponse,
} from '#shared/comparison/comparison.defs';

import type { SurfaceComparison, SurfaceEntry, SurfaceSide } from './packageSurface.defs';
import { packageSurfaceBadges } from './packageSurfaceBadges';
import {
  declarationBranches,
  exportDeclarations,
  pathBranches,
  versionSurface,
  type ExportMap,
  type ModuleFormat,
} from './packageSurfaceMetadata';
import { loadingUsage } from './packageSurfaceUsage';

type SurfaceMeasurement = Pick<MeasuredPackageVersion, 'name' | 'version' | 'bundledTypes'>;

type SurfaceMeasurements = Pick<PackageMeasurementsResponse, 'packageName'> & {
  from: SurfaceMeasurement;
  to: SurfaceMeasurement;
};

function matchesMeasurementPair(
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  measured: SurfaceMeasurements,
): boolean {
  return (
    measured.packageName === from.name &&
    from.name === to.name &&
    measured.from.name === from.name &&
    measured.from.version === from.version &&
    measured.to.name === to.name &&
    measured.to.version === to.version
  );
}

function matchingPatterns(key: string, map: ExportMap): string[] {
  if (map.has(key)) return [];

  return [...map.keys()].filter((pattern) => {
    const star = pattern.indexOf('*');

    return (
      star >= 0 &&
      key.startsWith(pattern.slice(0, star)) &&
      key.endsWith(pattern.slice(star + 1)) &&
      key.length >= pattern.length - 1
    );
  });
}

function declarationLabel(key: string, format: ModuleFormat, map: ExportMap): string {
  if (!map.has(key)) {
    if (matchingPatterns(key, map).length) return 'Pattern may apply';

    return format.exports === undefined ? 'No export map' : 'Not mapped';
  }

  const value = map.get(key);

  if (value === null) return 'Blocked';

  return declarationBranches(value).length ? 'Mapped' : 'Cannot determine';
}

function side(path: string, key: string, format: ModuleFormat, map: ExportMap): SurfaceSide {
  const value = map.get(key);
  const { entries, types } = pathBranches(key, format, map);

  const label = declarationLabel(key, format, map);
  const importUsage = loadingUsage(path, 'import', entries, format);
  const requireUsage = loadingUsage(path, 'require', entries, format);
  const patterns = matchingPatterns(key, map);
  const explanation = uncertainUsage(label, entries.length, patterns);

  if (explanation) {
    for (const item of [importUsage, requireUsage]) {
      item.label = label === 'No export map' ? 'Cannot determine' : label;
      item.detail = explanation;
    }
  }

  return {
    label,
    import: importUsage,
    require: requireUsage,
    types,
    signature: JSON.stringify([
      label,
      value,
      key === '.' ? [format.main, format.module, format.types, format.typings, format.typesVersions] : null,
      format.type,
      patterns.map((pattern) => [pattern, map.get(pattern)]),
    ]),
  };
}

function uncertainUsage(label: string, count: number, patterns: readonly string[]): string | undefined {
  if (label === 'No export map' && count === 0)
    return 'No explicit export map. Legacy file resolution may allow this path; metadata alone does not establish how to load it.';

  if (label === 'Pattern may apply')
    return `Matching export patterns: ${patterns.join(', ')}. Inspect the pattern rows; files and pattern resolution have not been checked.`;

  if (label === 'Cannot determine')
    return 'The declaration has no recognized loading target. Support cannot be established from this metadata.';

  return undefined;
}

function compareTreeKeys(left: string, right: string): number {
  const leftParts = left.split('/');
  const rightParts = right.split('/');

  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index] ?? '';
    const b = rightParts[index] ?? '';

    if (a !== b) return a < b ? -1 : 1;
  }

  return leftParts.length - rightParts.length;
}

function pathEntry(
  key: string,
  explicit: ReadonlySet<string>,
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  fromMap: ExportMap,
  toMap: ExportMap,
): SurfaceEntry {
  const path = key === '.' ? from.name : `${from.name}/${key.slice(2)}`;
  const before = side(path, key, from.moduleFormat, fromMap);
  const after = side(path, key, to.moduleFormat, toMap);
  const kind = !explicit.has(key) ? 'group' : key.includes('*') ? 'pattern' : 'entry';

  return {
    key,
    path,
    depth: key === '.' ? 0 : key.slice(2).split('/').length,
    kind,
    from: before,
    to: after,
  };
}

function exportChanges(
  entries: readonly SurfaceEntry[],
  from: SurfaceComparison['from'],
  to: SurfaceComparison['to'],
): SurfaceComparison['summary'] {
  if (from.exportCount === null || to.exportCount === null) {
    return {
      status: 'unavailable',
      reason: 'Export changes cannot be counted because one or both versions do not provide a complete export list.',
    };
  }

  const before = new Set(from.exportKeys);
  const after = new Set(to.exportKeys);

  const counts: Extract<SurfaceComparison['summary'], { status: 'available' }> = {
    status: 'available',
    same: 0,
    changed: 0,
    added: 0,
    removed: 0,
  };

  for (const entry of entries) {
    if (before.has(entry.key) && after.has(entry.key)) {
      if (entry.from.signature === entry.to.signature) counts.same += 1;
      else counts.changed += 1;
    } else if (after.has(entry.key)) counts.added += 1;
    else if (before.has(entry.key)) counts.removed += 1;
  }

  return counts;
}

export function buildPackageSurface(
  from: DeclaredPackageVersion,
  to: DeclaredPackageVersion,
  measurements?: SurfaceMeasurements,
): SurfaceComparison {
  const measured = measurements && matchesMeasurementPair(from, to, measurements) ? measurements : undefined;
  const fromMap = exportDeclarations(from.moduleFormat.exports);
  const toMap = exportDeclarations(to.moduleFormat.exports);
  const explicit = new Set(['.', ...fromMap.keys(), ...toMap.keys()]);
  const keys = new Set(explicit);

  for (const key of explicit) {
    if (!key.startsWith('./')) continue;

    const parts = key.slice(2).split('/');

    for (let index = 1; index < parts.length; index += 1) keys.add(`./${parts.slice(0, index).join('/')}`);
  }

  const entries = [...keys].sort(compareTreeKeys).map((key) => pathEntry(key, explicit, from, to, fromMap, toMap));

  const fromVersion = versionSurface(
    from,
    fromMap,
    packageSurfaceBadges(from.moduleFormat, measured?.from.bundledTypes),
  );

  const toVersion = versionSurface(to, toMap, packageSurfaceBadges(to.moduleFormat, measured?.to.bundledTypes));

  return { entries, from: fromVersion, to: toVersion, summary: exportChanges(entries, fromVersion, toVersion) };
}
