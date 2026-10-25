import type {
  AdvisoryComparison,
  AdvisoryGroup,
  ComparisonVersion,
  MeasurementComparison,
  PackageComparison,
  SizeComparison,
} from '#shared/comparison/comparison.defs';
import type { PackageAdvisory, PackageVulnerabilities } from '#shared/comparison/evidence/osv.defs';

import { compareInstallImplementation } from '../installScripts/compare';

type UnpackedSize = { value: number | null; source: 'registry' | 'tarball' | null };

function unpackedSize(version: ComparisonVersion): UnpackedSize {
  const declared = version.dist.unpackedSize;

  if (declared !== undefined && Number.isSafeInteger(declared) && declared >= 0)
    return { value: declared, source: 'registry' };

  // Partial tarballs have a complete inventory; only captured changelog text is partial.
  if (version.tarball.status !== 'unavailable') {
    return {
      value: version.tarball.files.reduce((sum, file) => sum + (file.type === 'file' ? file.size : 0), 0),
      source: 'tarball',
    };
  }

  return { value: null, source: null };
}

function sizeComparison(from: number | null, to: number | null, reasons: string[] = []): SizeComparison {
  const result: SizeComparison = {
    status: 'partial',
    from,
    to,
    delta: null,
    percent: null,
    reasons: [...reasons],
  };

  if (from === null) result.reasons.push('from measurement unavailable');

  if (to === null) result.reasons.push('to measurement unavailable');

  if (from === null && to === null) result.status = 'unavailable';

  if (from === null || to === null || reasons.length > 0) return result;
  result.status = 'available';
  result.delta = to - from;
  result.percent = from === 0 ? null : (result.delta / from) * 100;

  return result;
}

function advisoryAliases(advisory: PackageAdvisory): readonly string[] {
  return advisory.detailsStatus === 'available' ? (advisory.aliases ?? []) : [];
}

function advisoryRoot(parents: Map<string, string>, id: string): string {
  let current = id;
  let parent = parents.get(current);

  while (parent !== undefined) {
    current = parent;
    parent = parents.get(current);
  }

  let next = id;
  parent = parents.get(next);

  while (parent !== undefined && parent !== current) {
    parents.set(next, current);
    next = parent;
    parent = parents.get(next);
  }

  return current;
}

function groupsByAdvisoryIdentity(
  parents: Map<string, string>,
  from: PackageVulnerabilities,
  to: PackageVulnerabilities,
): Map<string, AdvisoryGroup> {
  const groups = new Map<string, AdvisoryGroup>();

  for (const [side, evidence] of [
    ['from', from],
    ['to', to],
  ] as const) {
    for (const record of evidence.advisories) {
      const key = advisoryRoot(parents, record.id);
      let group = groups.get(key);

      if (!group) {
        group = { ids: [], aliases: [], from: [], to: [] };
        groups.set(key, group);
      }

      group[side].push(record);
    }
  }

  return groups;
}

function groupAdvisories(from: PackageVulnerabilities, to: PackageVulnerabilities): AdvisoryGroup[] {
  // Union-find joins aliases transitively; `related` records are deliberately not identities.
  const parents = new Map<string, string>();

  for (const record of [...from.advisories, ...to.advisories]) {
    for (const alias of advisoryAliases(record)) {
      const left = advisoryRoot(parents, record.id);
      const right = advisoryRoot(parents, alias);

      if (left !== right) parents.set(right, left);
    }
  }

  return [...groupsByAdvisoryIdentity(parents, from, to).values()]
    .map((group) => {
      const records = [...group.from, ...group.to];
      group.ids = [...new Set(records.map((record) => record.id))].sort();
      group.aliases = [...new Set(records.flatMap((record) => advisoryAliases(record)))].sort();
      group.from.sort((a, b) => a.id.localeCompare(b.id));
      group.to.sort((a, b) => a.id.localeCompare(b.id));

      return group;
    })
    .sort((a, b) => (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''));
}

function advisoryCategory(group: AdvisoryGroup, complete: boolean): 'both' | 'uncertain' | 'fromOnly' | 'toOnly' {
  if (group.from.length && group.to.length) return 'both';

  if (!complete) return 'uncertain';

  return group.from.length ? 'fromOnly' : 'toOnly';
}

function compareAdvisories(from: PackageVulnerabilities, to: PackageVulnerabilities): AdvisoryComparison {
  const complete = from.status === 'available' && to.status === 'available';

  const result: AdvisoryComparison = {
    status: complete
      ? 'available'
      : from.status === 'unavailable' && to.status === 'unavailable'
        ? 'unavailable'
        : 'partial',
    coverage: { from: from.status, to: to.status },
    reasons: [],
    fromOnly: [],
    both: [],
    toOnly: [],
    uncertain: [],
  };

  for (const [side, evidence] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (evidence.status !== 'available')
      result.reasons.push(`${side} advisory coverage ${evidence.status}; absence is not proof of resolution`);
  }

  for (const group of groupAdvisories(from, to)) result[advisoryCategory(group, complete)].push(group);

  return result;
}

function compareSizes(from: ComparisonVersion, to: ComparisonVersion): PackageComparison['sizes'] {
  const oldSize = unpackedSize(from);
  const newSize = unpackedSize(to);
  const bundleReasons: string[] = [];

  // Missing dependencies change what was measured. Do not present those builds as comparable.
  for (const build of [from.bundleSize, to.bundleSize]) {
    if (build.status === 'available' && build.ignoredMissingDependencies?.length) {
      bundleReasons.push('Provider build omitted dependencies; estimates are not comparable');
      break;
    }
  }

  return {
    unpacked: {
      ...sizeComparison(oldSize.value, newSize.value),
      sources: { from: oldSize.source, to: newSize.source },
    },
    bundle: {
      provider: 'bundlephobia',
      methodology: 'provider-estimate',
      minified: sizeComparison(from.bundleSize.size, to.bundleSize.size, bundleReasons),
      gzip: sizeComparison(from.bundleSize.gzip, to.bundleSize.gzip, bundleReasons),
    },
  };
}

export function compareMeasurements(from: ComparisonVersion, to: ComparisonVersion): MeasurementComparison {
  return {
    sizes: compareSizes(from, to),
    advisories: compareAdvisories(from.vulnerabilities, to.vulnerabilities),
    installImplementation: compareInstallImplementation(from.tarball.installInspection, to.tarball.installInspection),
  };
}
