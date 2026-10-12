import type {
  BriefingEvidence,
  BriefingInput,
  BriefingSource,
  BriefingSourceDraft,
} from '../../../../shared/comparison/briefing/briefing.defs';
import type { ComparisonVersion, PackageComparison } from '../../../../shared/comparison/comparison.defs';
import type { PackageReleaseNotes } from '../../../../shared/comparison/evidence/github.defs';

const MAX_PACKET_BYTES = 48 * 1024;

const MAX_SOURCES = 64;

const MAX_COVERAGE_ITEMS = 128;

const MAX_COVERAGE_REASON_BYTES = 512;

const COVERAGE_LIMITATION =
  "This is direct-package evidence, not the application's dependency tree, a runtime test, or an actual application bundle measurement.";

const textEncoder = new TextEncoder();

const byteLength = (value: string): number => textEncoder.encode(value).byteLength;

const json = <T>(value: T): string => JSON.stringify(value) ?? 'null';

const boundedText = (value: string, maxBytes: number): string => {
  if (byteLength(value) <= maxBytes) return value;

  let bytes = 0;
  let end = 0;

  for (const character of value) {
    const size = byteLength(character);

    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }

  return value.slice(0, end);
};

const unique = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value.length > 0))];

const boundedList = (values: readonly string[], itemBytes = MAX_COVERAGE_REASON_BYTES, totalBytes = 4096): string[] => {
  const result: string[] = [];
  let bytes = 0;

  for (const value of values) {
    if (result.length >= MAX_COVERAGE_ITEMS) break;
    const item = boundedText(value, itemBytes);
    const separatorBytes = result.length === 0 ? 0 : 1;

    if (bytes + separatorBytes + byteLength(item) > totalBytes) break;
    result.push(item);
    bytes += separatorBytes + byteLength(item);
  }

  return result;
};

export type BriefingEvidenceCandidate = {
  source: BriefingSourceDraft;
  priority: number;
  truncated?: boolean;
};

type CoverageDetails = {
  scope: { packageName: string; from: string; to: string };
  availability: {
    releaseNotes: {
      status: PackageReleaseNotes['status'];
      reasons: string[];
      releases: number;
      repositoryChangelog: { path: string; ref: string } | null;
    };
    from: {
      advisories: { status: ComparisonVersion['vulnerabilities']['status']; count: number | null };
      bundle: { status: ComparisonVersion['bundleSize']['status']; url: string };
      tarball: { status: ComparisonVersion['tarball']['status']; reasons: string[]; changelogs: number };
    };
    to: {
      advisories: { status: ComparisonVersion['vulnerabilities']['status']; count: number | null };
      bundle: { status: ComparisonVersion['bundleSize']['status']; url: string };
      tarball: { status: ComparisonVersion['tarball']['status']; reasons: string[]; changelogs: number };
    };
  };
  comparison: {
    advisoryStatus: PackageComparison['advisories']['status'];
    advisoryCoverage: PackageComparison['advisories']['coverage'];
    advisoryUncertainGroups: number;
    sizeReasons: string[];
  };
  gaps: string[];
  omitted: { sourceIds: string[]; count: number };
  truncated: { sourceIds: string[]; count: number };
  limitations: readonly [string];
};

const boundedUrl = (value: string): string => boundedText(value, MAX_COVERAGE_REASON_BYTES);

const boundedReasons = (values: readonly string[]): string[] => boundedList(unique(values));

type CoverageAvailability = CoverageDetails['availability'];

type PackageAvailability = CoverageAvailability['from'];

function releaseAvailability(input: BriefingInput): CoverageAvailability['releaseNotes'] {
  const changelog = input.releaseNotes.changelog;

  return {
    status: input.releaseNotes.status,
    reasons: boundedReasons(input.releaseNotes.reasons),
    releases: input.releaseNotes.releases.length,
    repositoryChangelog:
      changelog === null ? null : { path: boundedUrl(changelog.path), ref: boundedUrl(changelog.ref) },
  };
}

function packageAvailability(version: ComparisonVersion): PackageAvailability {
  return {
    advisories: { status: version.vulnerabilities.status, count: version.vulnerabilities.count },
    bundle: { status: version.bundleSize.status, url: boundedUrl(version.bundleSize.url) },
    tarball: {
      status: version.tarball.status,
      reasons: boundedReasons(version.tarball.reasons),
      changelogs: version.tarball.changelogs.length,
    },
  };
}

function comparisonAvailability(input: BriefingInput): CoverageDetails['comparison'] {
  return {
    advisoryStatus: input.comparison.advisories.status,
    advisoryCoverage: input.comparison.advisories.coverage,
    advisoryUncertainGroups: input.comparison.advisories.uncertain.length,
    sizeReasons: boundedReasons([
      ...input.comparison.sizes.unpacked.reasons,
      ...input.comparison.sizes.bundle.minified.reasons,
      ...input.comparison.sizes.bundle.gzip.reasons,
    ]),
  };
}

function coverageDetails(
  input: BriefingInput,
  gaps: readonly string[],
  omitted: readonly string[],
  truncated: readonly string[],
): CoverageDetails {
  return {
    scope: {
      packageName: boundedUrl(input.packageName),
      from: boundedUrl(input.from.version),
      to: boundedUrl(input.to.version),
    },
    availability: {
      releaseNotes: releaseAvailability(input),
      from: packageAvailability(input.from),
      to: packageAvailability(input.to),
    },
    comparison: comparisonAvailability(input),
    gaps: boundedList(unique(gaps)),
    omitted: { sourceIds: boundedList(unique(omitted), 256), count: omitted.length },
    truncated: { sourceIds: boundedList(unique(truncated), 256), count: truncated.length },
    limitations: [COVERAGE_LIMITATION],
  };
}

function coverageSource(
  input: BriefingInput,
  gaps: readonly string[],
  omitted: readonly string[],
  truncated: readonly string[],
): BriefingSourceDraft {
  return {
    id: 'coverage',
    kind: 'coverage',
    label: 'Evidence coverage and limitations',
    urls: [],
    text: json(coverageDetails(input, gaps, omitted, truncated)),
  };
}

/**
 * Packet positions are the citation numbers: the model cites `sources[].number`, the response reports the same
 * numbers, and the evidence index renders them verbatim. Admission budgets what this returns, so the bytes and the
 * numbers it sees are the bytes and numbers the packet keeps.
 */
const numberedSources = (
  accepted: readonly BriefingEvidenceCandidate[],
  coverage: BriefingSourceDraft,
): readonly BriefingSource[] => [
  ...accepted.map(({ source }, position) => ({ ...source, number: position + 1 })),
  { ...coverage, number: accepted.length + 1 },
];

function packetByteLength(input: BriefingInput, gaps: readonly string[], sourceJson: readonly string[]): number {
  const prefix = `{"packageName":${json(input.packageName)},"from":${json(input.from.version)},"to":${json(input.to.version)},"sources":[`;
  const suffix = `],"gaps":${json(gaps)}}`;

  return byteLength(`${prefix}${sourceJson.join(',')}${suffix}`);
}

function assertIdentityFits(input: BriefingInput): void {
  if (input.packageName.trim() === '' || input.from.version.trim() === '' || input.to.version.trim() === '') {
    throw new Error('Briefing identity is malformed');
  }

  const minimalCoverage = coverageSource(input, [], [], []);
  const serialized = numberedSources([], minimalCoverage).map((source) => json(source));

  if (packetByteLength(input, [], serialized) > MAX_PACKET_BYTES) {
    throw new Error('Briefing identity exceeds evidence packet bounds');
  }
}

const packetGaps = (
  baseGaps: readonly string[],
  omitted: ReadonlySet<string>,
  truncated: readonly string[],
): string[] =>
  boundedList(
    unique([
      ...baseGaps,
      ...[...omitted].map((id) => `Evidence source ${id} was omitted to keep the briefing packet within its bounds`),
      ...truncated.map((id) => `Evidence source ${id} contains a partial prose excerpt`),
    ]),
  );

function packetFits(
  input: BriefingInput,
  accepted: readonly BriefingEvidenceCandidate[],
  coverage: BriefingSourceDraft,
  gaps: readonly string[],
): boolean {
  const sources = numberedSources(accepted, coverage);

  return (
    sources.length <= MAX_SOURCES &&
    packetByteLength(
      input,
      gaps,
      sources.map((source) => json(source)),
    ) <= MAX_PACKET_BYTES
  );
}

function packetResult(
  input: BriefingInput,
  candidates: readonly BriefingEvidenceCandidate[],
  accepted: readonly BriefingEvidenceCandidate[],
  baseGaps: readonly string[],
  omitted: ReadonlySet<string>,
): BriefingEvidence | null {
  const truncatedIds: string[] = [];

  for (const candidate of candidates) {
    if (candidate.truncated) truncatedIds.push(candidate.source.id);
  }

  const truncated = unique(truncatedIds);

  const gaps = packetGaps(baseGaps, omitted, truncated);
  const coverage = coverageSource(input, gaps, [...omitted], truncated);

  if (!packetFits(input, accepted, coverage, gaps)) return null;

  return {
    packageName: input.packageName,
    from: input.from.version,
    to: input.to.version,
    sources: numberedSources(accepted, coverage),
    gaps,
  };
}

export function packBriefingEvidence(
  input: BriefingInput,
  candidates: readonly BriefingEvidenceCandidate[],
  baseGaps: readonly string[],
): BriefingEvidence {
  assertIdentityFits(input);
  const complete = packetResult(input, candidates, candidates, baseGaps, new Set<string>());

  if (complete !== null) return complete;

  // Budget coverage for every omission before accepting sources. A source that cannot fit
  // must not evict smaller facts; admitting sources in priority order avoids that cascade.
  const omitted = new Set(candidates.map(({ source }) => source.id));
  const accepted: BriefingEvidenceCandidate[] = [];

  for (const candidate of candidates.toSorted((left, right) => left.priority - right.priority)) {
    if (accepted.length + 1 >= MAX_SOURCES) break;
    omitted.delete(candidate.source.id);
    accepted.push(candidate);

    if (packetResult(input, candidates, accepted, baseGaps, omitted) === null) {
      accepted.pop();
      omitted.add(candidate.source.id);
    }
  }

  const result = packetResult(input, candidates, accepted, baseGaps, omitted);

  if (result === null) throw new Error('Briefing evidence exceeds packet bounds');

  return result;
}
