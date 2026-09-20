import type { BriefingEvidence, BriefingInput, BriefingSource } from '../../shared/briefing.defs';
import type { AdvisoryGroup, PackageComparison } from '../../shared/comparison.defs';
import type { PackageAdvisory } from '../../shared/osv.defs';
import { buildMaintainerCandidates } from './packageBriefingEvidenceChangelog';
import { packBriefingEvidence, type BriefingEvidenceCandidate } from './packageBriefingEvidencePacking';

const MAX_GAP_BYTES = 512;
const textEncoder = new TextEncoder();
const json = (value: unknown): string => JSON.stringify(value) ?? 'null';
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

function advisoryUrls(comparison: PackageComparison): string[] {
  const groups: readonly AdvisoryGroup[] = [
    ...comparison.advisories.fromOnly,
    ...comparison.advisories.both,
    ...comparison.advisories.toOnly,
    ...comparison.advisories.uncertain,
  ];
  return unique(groups.flatMap((group) => [...group.from, ...group.to].map(({ url }) => url)));
}

function advisorySummary(advisory: PackageAdvisory) {
  if (advisory.detailsStatus !== 'available') return advisory;
  const { id, url, detailsStatus, summary, severity } = advisory;
  return { id, url, detailsStatus, summary, severity };
}

function advisoryEvidence(comparison: PackageComparison) {
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
  value: unknown,
  urls: readonly string[],
  priority: number,
): BriefingEvidenceCandidate {
  const source: BriefingSource = { id, kind: 'fact', label, urls: unique(urls), text: json(value) };
  return { source, serialized: json(source), priority };
}

function compatibilityCandidates(input: BriefingInput, versions: readonly string[]): BriefingEvidenceCandidate[] {
  return [
    structuredSource(
      'comparison.advisories',
      'Computed advisory comparison',
      advisoryEvidence(input.comparison),
      advisoryUrls(input.comparison),
      0,
    ),
    structuredSource(
      'comparison.node',
      'Computed Node engine declaration comparison',
      input.comparison.node,
      versions,
      1,
    ),
    structuredSource(
      'comparison.moduleFormat',
      'Computed module-format declaration comparison',
      input.comparison.moduleFormat,
      versions,
      1,
    ),
    structuredSource(
      'comparison.exports',
      'Computed export-map declaration comparison',
      input.comparison.exports,
      versions,
      1,
    ),
    structuredSource(
      'comparison.types',
      'Computed type-entry declaration comparison',
      input.comparison.types,
      versions,
      1,
    ),
    structuredSource(
      'comparison.peers',
      'Computed peer-dependency declaration comparison',
      input.comparison.peers,
      versions,
      1,
    ),
    structuredSource(
      'comparison.installScripts',
      'Computed lifecycle-script declaration comparison',
      input.comparison.installScripts,
      versions,
      1,
    ),
    structuredSource(
      'comparison.licenses',
      'Computed license declaration comparison',
      input.comparison.licenses,
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
