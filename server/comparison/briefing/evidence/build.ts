import type {
  BriefingEvidence,
  BriefingInput,
  BriefingSourceDraft,
} from '../../../../shared/comparison/briefing/briefing.defs';
import type {
  AdvisoryComparison,
  AdvisoryGroup,
  PackageComparison,
} from '../../../../shared/comparison/comparison.defs';
import type { PackageAdvisory } from '../../../../shared/comparison/evidence/osv.defs';
import { buildMaintainerCandidates } from './changelog';
import { packBriefingEvidence, type BriefingEvidenceCandidate } from './packing';

const MAX_GAP_BYTES = 512;

const textEncoder = new TextEncoder();

const json = <T>(value: T): string => JSON.stringify(value) ?? 'null';

const byteLength = (value: string): number => textEncoder.encode(value).byteLength;

const boundedGap = (value: string): string => {
  if (byteLength(value) <= MAX_GAP_BYTES) return value;
  let bytes = 0;
  let end = 0;

  for (const character of value) {
    const size = byteLength(character);

    if (bytes + size > MAX_GAP_BYTES) break;
    bytes += size;
    end += character.length;
  }

  return value.slice(0, end);
};

const unique = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value.length > 0))];

const registryManifestUrl = (packageName: string, version: string): string =>
  `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;

const versionUrls = (input: BriefingInput): string[] =>
  unique([
    registryManifestUrl(input.packageName, input.from.version),
    registryManifestUrl(input.packageName, input.to.version),
  ]);

/** Advisory details are summarized down to the reviewed fields before entering an evidence packet. */
export type AdvisorySummary =
  | PackageAdvisory
  | {
      readonly id: string;
      readonly url: string;
      readonly detailsStatus: 'available';
      readonly summary: Extract<PackageAdvisory, { detailsStatus: 'available' }>['summary'];
      readonly severity: Extract<PackageAdvisory, { detailsStatus: 'available' }>['severity'];
    };

type AdvisorySummaryGroup = Pick<AdvisoryGroup, 'ids' | 'aliases'> & {
  readonly from: readonly AdvisorySummary[];
  readonly to: readonly AdvisorySummary[];
};

/** The advisory evidence comparison reduces own side groups to summarized, bounded content. */
export type AdvisoryComparisonEvidence = Pick<AdvisoryComparison, 'status' | 'coverage' | 'reasons'> & {
  readonly detailScope: string;
  readonly fromOnly: readonly AdvisorySummaryGroup[];
  readonly both: readonly AdvisorySummaryGroup[];
  readonly toOnly: readonly AdvisorySummaryGroup[];
  readonly uncertain: readonly AdvisorySummaryGroup[];
};

function advisoryUrls(comparison: PackageComparison): string[] {
  const groups: readonly AdvisoryGroup[] = [
    ...comparison.advisories.fromOnly,
    ...comparison.advisories.both,
    ...comparison.advisories.toOnly,
    ...comparison.advisories.uncertain,
  ];

  return unique(groups.flatMap((group) => [...group.from, ...group.to].map(({ url }) => url)));
}

function advisorySummary(advisory: PackageAdvisory): AdvisorySummary {
  if (advisory.detailsStatus !== 'available') return advisory;
  const { id, url, detailsStatus, summary, severity } = advisory;

  return { id, url, detailsStatus, summary, severity };
}

/** One evidence-field payload: a comparison member value, or the advisory summary derived from it. */
type EvidenceComparisonValue = PackageComparison[keyof PackageComparison] | AdvisoryComparisonEvidence;

function advisoryEvidence(comparison: PackageComparison): AdvisoryComparisonEvidence {
  const summarizeGroups = (groups: readonly AdvisoryGroup[]) =>
    groups.map(({ ids, aliases, from, to }) => ({
      ids,
      aliases,
      from: from.map(advisorySummary),
      to: to.map(advisorySummary),
    }));

  const { status, coverage, reasons, fromOnly, both, toOnly, uncertain } = comparison.advisories;

  return {
    status,
    coverage,
    reasons,
    detailScope:
      'Match groups, identifiers, summaries and severity only; affected-version ranges and reference lists are not included.',
    fromOnly: summarizeGroups(fromOnly),
    both: summarizeGroups(both),
    toOnly: summarizeGroups(toOnly),
    uncertain: summarizeGroups(uncertain),
  };
}

function structuredSource(
  id: string,
  label: string,
  value: EvidenceComparisonValue,
  urls: readonly string[],
  priority: number,
): BriefingEvidenceCandidate {
  const source: BriefingSourceDraft = { id, kind: 'fact', label, urls: unique(urls), text: json(value) };

  return { source, priority };
}

/**
 * One candidate in the declaration-comparison family: every member shares the Node-versions URL set, the same
 * `Computed … declaration comparison` label pattern, and the same priority, so the id and label derive from one key.
 */
const declarationCandidate = (
  id: string,
  label: string,
  versions: readonly string[],
  value: EvidenceComparisonValue,
): BriefingEvidenceCandidate =>
  structuredSource(`comparison.${id}`, `Computed ${label} declaration comparison`, value, versions, 1);

function compatibilityCandidates(input: BriefingInput, versions: readonly string[]): BriefingEvidenceCandidate[] {
  const comparison = input.comparison;

  return [
    structuredSource(
      'comparison.advisories',
      'Computed advisory comparison',
      advisoryEvidence(comparison),
      advisoryUrls(comparison),
      0,
    ),
    declarationCandidate('node', 'Node engine', versions, comparison.node),
    declarationCandidate('moduleFormat', 'module-format', versions, comparison.moduleFormat),
    declarationCandidate('exports', 'export-map', versions, comparison.exports),
    declarationCandidate('types', 'type-entry', versions, comparison.types),
    declarationCandidate('peers', 'peer-dependency', versions, comparison.peers),
    declarationCandidate('installScripts', 'lifecycle-script', versions, comparison.installScripts),
    structuredSource(
      'comparison.licenses',
      'Computed license declaration comparison',
      comparison.licenses,
      versions,
      2,
    ),
  ];
}

function measurementCandidates(input: BriefingInput, versions: readonly string[]): BriefingEvidenceCandidate[] {
  return [
    structuredSource(
      'comparison.sizes',
      'Computed package-size comparison and measurement methodology',
      input.comparison.sizes,
      [...versions, input.from.bundleSize.url, input.to.bundleSize.url, input.from.tarball.url, input.to.tarball.url],
      3,
    ),
    structuredSource(
      'comparison.dependencies',
      'Computed dependency declaration comparison',
      input.comparison.dependencies,
      versions,
      5,
    ),
  ];
}

function structuredCandidates(input: BriefingInput): BriefingEvidenceCandidate[] {
  const versions = versionUrls(input);

  return [...compatibilityCandidates(input, versions), ...measurementCandidates(input, versions)];
}

function addGap(gaps: string[], value: string): void {
  const bounded = boundedGap(value);

  if (bounded !== '' && !gaps.includes(bounded)) gaps.push(bounded);
}

function versionGaps(gaps: string[], side: 'from' | 'to', input: BriefingInput): void {
  const version = input[side];

  if (version.vulnerabilities.status !== 'available') {
    addGap(gaps, `${side} advisory coverage is ${version.vulnerabilities.status}`);
  }

  for (const reason of version.tarball.reasons) addGap(gaps, `${side} tarball: ${reason}`);

  if (version.tarball.status !== 'available') addGap(gaps, `${side} tarball coverage is ${version.tarball.status}`);

  if (version.bundleSize.status !== 'available')
    addGap(gaps, `${side} bundle measurement is ${version.bundleSize.status}`);
}

function baseGaps(input: BriefingInput): string[] {
  const gaps: string[] = [];

  for (const reason of input.releaseNotes.reasons) addGap(gaps, `release notes: ${reason}`);

  if (input.releaseNotes.status !== 'available') addGap(gaps, `release notes coverage is ${input.releaseNotes.status}`);

  if (input.releaseNotes.releases.length === 0 && input.releaseNotes.changelog === null) {
    addGap(gaps, 'release notes: no matched release body or pinned changelog was collected');
  }

  versionGaps(gaps, 'from', input);
  versionGaps(gaps, 'to', input);

  for (const reason of input.comparison.advisories.reasons) addGap(gaps, `advisories: ${reason}`);

  for (const reason of [
    ...input.comparison.sizes.unpacked.reasons,
    ...input.comparison.sizes.bundle.minified.reasons,
    ...input.comparison.sizes.bundle.gzip.reasons,
  ])
    addGap(gaps, `sizes: ${reason}`);

  return gaps;
}

export function buildBriefingEvidence(input: BriefingInput): BriefingEvidence {
  const gaps = baseGaps(input);
  const candidates = [...structuredCandidates(input), ...buildMaintainerCandidates(input, (gap) => addGap(gaps, gap))];

  return packBriefingEvidence(input, candidates, gaps);
}
