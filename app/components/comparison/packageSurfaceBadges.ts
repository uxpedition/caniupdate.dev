import type { BundledTypeEvidence } from '#shared/comparison/evidence/types.defs';
import type { ParsedPackageMetadata } from '#shared/comparison/package/package.defs';

import type { SurfaceBranch } from './packageSurface.defs';
import { declarationBranches, exportDeclarations, type ModuleFormat } from './packageSurfaceMetadata';

export type SurfaceBadge = {
  name: 'ESM' | 'CJS' | 'TYPES';
  confidence: 'strong' | 'possible';
  detail: string;
  source?: 'archive';
  warning?: 'deprecated-external-types';
  packageName?: string;
  href?: string;
};

function evidence(name: SurfaceBadge['name'], confidence: SurfaceBadge['confidence'], reason: string): SurfaceBadge {
  return {
    name,
    confidence,
    detail: `${reason} Metadata only; published files and runtime compatibility have not been verified.`,
  };
}

function ambiguousFormatBadges(target: string, conditions: readonly string[]): SurfaceBadge[] {
  const badges: SurfaceBadge[] = [];
  const esmHint = conditions.includes('import') || conditions.includes('module');

  if (esmHint)
    badges.push(
      evidence('ESM', 'possible', `${target} has an ESM-oriented condition without an explicit file format.`),
    );

  if (conditions.includes('require') || (!esmHint && (target.endsWith('.js') || conditions.includes('main')))) {
    badges.push(
      evidence('CJS', 'possible', `${target} may use CommonJS conventions, but its file format is not explicit.`),
    );
  }

  return badges;
}

function explicitFormatEvidence(target: string, type: ModuleFormat['type']): SurfaceBadge | null {
  if (target.endsWith('.mjs')) return evidence('ESM', 'strong', `${target} explicitly declares the file format.`);

  if (target.endsWith('.cjs')) return evidence('CJS', 'strong', `${target} explicitly declares the file format.`);

  if (target.endsWith('.js') && (type === 'module' || type === 'commonjs')) {
    return evidence(
      type === 'module' ? 'ESM' : 'CJS',
      'strong',
      `${target} uses the package's explicit type: ${type}. Nested package rules may differ.`,
    );
  }

  return null;
}

function entryBadges({ target, conditions }: SurfaceBranch, type: ModuleFormat['type']): SurfaceBadge[] {
  if (!target) return [];

  if (
    /\.d\.[cm]?ts$/.test(target) ||
    conditions.some((condition) => condition === 'types' || condition.startsWith('types@'))
  ) {
    return [evidence('TYPES', 'strong', `Type declarations point to ${target}.`)];
  }

  const explicit = explicitFormatEvidence(target, type);

  if (explicit) return [explicit];

  if (/\.[cm]ts$/.test(target)) {
    return [
      evidence(
        target.endsWith('.cts') ? 'CJS' : 'ESM',
        'possible',
        `${target} is a TypeScript source target; loading depends on tooling.`,
      ),
    ];
  }

  return target.endsWith('.js') || !/\.[^/]+$/.test(target) ? ambiguousFormatBadges(target, conditions) : [];
}

function manifestBadges(format: ModuleFormat, entries: readonly SurfaceBranch[]): SurfaceBadge[] {
  const badges = [format.types, format.typings].flatMap((target) =>
    target ? [evidence('TYPES', 'strong', `The package declares bundled types at ${target}.`)] : [],
  );

  if (format.module) badges.push(...entryBadges({ conditions: ['module'], target: format.module }, format.type));

  if (!entries.length && format.exports === undefined && (format.type === 'module' || format.type === 'commonjs')) {
    badges.push(
      evidence(
        format.type === 'module' ? 'ESM' : 'CJS',
        'possible',
        `The package declares type: ${format.type}, but no entry target is listed.`,
      ),
    );
  }

  if (declarationBranches(format.typesVersions).some(({ target }) => target)) {
    badges.push(
      evidence(
        'TYPES',
        'possible',
        'Compiler-version mappings suggest type declarations; coverage depends on TypeScript and resolution settings.',
      ),
    );
  }

  return badges;
}

function archiveTypesBadge(bundledTypes?: BundledTypeEvidence): SurfaceBadge | null {
  if (!bundledTypes || bundledTypes.status === 'unavailable' || bundledTypes.matchedTargetCount === 0) return null;

  return {
    name: 'TYPES',
    confidence: 'possible',
    source: 'archive',
    detail: `Matching declaration files were found for ${bundledTypes.matchedTargetCount} JavaScript entry targets in this published release. Type resolution, correctness, and coverage of all exports have not been verified.`,
  };
}

export function packageSurfaceBadges(format: ModuleFormat, bundledTypes?: BundledTypeEvidence): SurfaceBadge[] {
  const entries = [...exportDeclarations(format.exports).values()].flatMap((value) => declarationBranches(value));

  if (format.exports === undefined && format.main) entries.push({ conditions: ['main'], target: format.main });

  const badges = new Map<SurfaceBadge['name'], SurfaceBadge>();

  for (const badge of [
    ...entries.flatMap((entry) => entryBadges(entry, format.type)),
    ...manifestBadges(format, entries),
  ]) {
    if (badges.get(badge.name)?.confidence !== 'strong') badges.set(badge.name, badge);
  }

  const shipped = archiveTypesBadge(bundledTypes);

  if (shipped && badges.get('TYPES')?.confidence !== 'strong') badges.set('TYPES', shipped);

  return (['ESM', 'CJS', 'TYPES'] as const).flatMap((name) => {
    const badge = badges.get(name);

    return badge ? [badge] : [];
  });
}

export function typesPackageName(name: string): string | null {
  if (!name || name.startsWith('@types/')) return null;

  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
}

export function hasBundledTypesEvidence(badges: readonly SurfaceBadge[]): boolean {
  return badges.some(
    (badge) => badge.name === 'TYPES' && (badge.confidence === 'strong' || badge.source === 'archive'),
  );
}

export function withExternalTypes(
  badges: readonly SurfaceBadge[],
  metadata: Pick<ParsedPackageMetadata, 'name' | 'latestRelease'> | null,
  comparedVersion: string,
): readonly SurfaceBadge[] {
  if (!metadata || hasBundledTypesEvidence(badges)) return badges;

  const packageName = metadata.name;
  const deprecation = metadata.latestRelease?.deprecated?.trim();

  const detail = deprecation
    ? `The latest release, ${packageName}@${metadata.latestRelease?.version}, is deprecated. Check whether package version ${comparedVersion} needs external types and which @types version applies. Maintainer notice: ${deprecation}`
    : `${packageName} exists. Check its supported package versions; compatibility with package version ${comparedVersion} has not been verified.`;

  const external: SurfaceBadge = {
    name: 'TYPES',
    confidence: 'possible',
    detail,
    packageName,
    href: `https://npmx.dev/package/${packageName}`,
  };

  if (deprecation) external.warning = 'deprecated-external-types';

  return [...badges.filter((badge) => badge.name !== 'TYPES'), external];
}
