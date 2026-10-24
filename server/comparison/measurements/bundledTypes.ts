import { Predicate, type Schema } from 'effect';

import type { DeclaredPackageVersion } from '#shared/comparison/comparison.defs';
import type { PackageTarball } from '#shared/comparison/evidence/tarball.defs';
import type { BundledTypeEvidence } from '#shared/comparison/evidence/types.defs';

const isExportContainer = (value: Schema.Json | undefined): value is Schema.JsonObject | Schema.JsonArray =>
  Predicate.isObjectOrArray(value);

function collectTargets(value: Schema.Json | undefined, targets: Set<string>): void {
  if (Predicate.isString(value)) {
    if (!value.includes('*') && /\.[cm]?js$/.test(value)) targets.add(value.replace(/^\.\//, ''));

    return;
  }

  if (!isExportContainer(value)) return;

  for (const [condition, child] of Object.entries(value)) {
    if (condition === 'types' || condition.startsWith('types@') || condition.includes('*')) continue;
    collectTargets(child, targets);
  }
}

/** Exact file matches are hints, not a TypeScript resolver or a coverage check. */
export function getBundledTypeEvidence(
  format: DeclaredPackageVersion['moduleFormat'],
  tarball: PackageTarball,
): BundledTypeEvidence {
  if (tarball.status === 'unavailable') return { status: 'unavailable', matchedTargetCount: null };

  const targets = new Set<string>();

  if (format.exports === undefined) {
    collectTargets(format.main, targets);
    collectTargets(format.module, targets);
  } else collectTargets(format.exports, targets);

  if (targets.size === 0) return { status: tarball.status, matchedTargetCount: 0 };

  const files = new Set<string>();

  for (const file of tarball.files) if (file.type === 'file') files.add(file.path);

  let matchedTargetCount = 0;

  for (const target of targets) {
    const declaration = target.replace(/\.([cm]?)js$/, '.d.$1ts');

    if (files.has(target) && files.has(declaration)) matchedTargetCount += 1;
  }

  return { status: tarball.status, matchedTargetCount };
}
