import type { BriefingInput } from '../../../../shared/comparison/briefing/briefing.defs';
import { compareSemver, isExactSemver } from '../../../../shared/comparison/package/compareSemver';
import type { BriefingEvidenceCandidate } from './packing';

const MAX_MAINTAINER_BYTES = 4 * 1024;

const textEncoder = new TextEncoder();

const byteLength = (value: string): number => textEncoder.encode(value).byteLength;

type BoundedText = { text: string; truncated: boolean };

const boundedText = (value: string, maxBytes: number): BoundedText => {
  if (byteLength(value) <= maxBytes) return { text: value, truncated: false };

  let bytes = 0;
  let end = 0;

  for (const character of value) {
    const size = byteLength(character);

    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }

  return { text: value.slice(0, end), truncated: true };
};

const unique = (values: readonly string[]): string[] => [...new Set(values.filter((value) => value.length > 0))];

const VERSION_PATTERN =
  /v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/;

const VERSION_IN_TEXT_PATTERN = /\b(?:v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;

type Heading = {
  line: number;
  level: number;
  version: string | null;
  unreleased: boolean;
};

type ChangelogSection = {
  version: string;
  text: string;
};

type MaintainerRecord = {
  version: string;
  text: string;
  label: string;
  url: string;
  origin: 'release' | 'repository-changelog' | 'published-changelog';
  truncated: boolean;
};

type ChangelogDocument = {
  label: string;
  url: string;
  body: string;
  inputTruncated: boolean;
};

type Fence = '`' | '~';

type FenceLine = { marker: Fence; length: number };

type PreparedHeading = { value: string; bracketed: boolean };

function prepareHeading(content: string, packageName: string): PreparedHeading {
  let value = content.trim();
  const bracketed = value.startsWith('[');

  if (bracketed) value = value.slice(1).trimStart();

  if (/^version(?:\s*[:=]\s*|\s+)/i.test(value)) {
    value = value.replace(/^version(?:\s*[:=]\s*|\s+)/i, '');
  }

  if (value.startsWith(`${packageName}@`)) value = value.slice(packageName.length + 1);

  return { value, bracketed };
}

function versionRemainder(value: string, rawVersion: string, bracketed: boolean): string | null {
  let remainder = value.slice(rawVersion.length).trimStart();

  if (bracketed) {
    if (!remainder.startsWith(']')) return null;
    remainder = remainder.slice(1).trimStart();
  }

  if (VERSION_IN_TEXT_PATTERN.test(remainder)) return null;

  if (remainder !== '' && !/^[\]([{:;,/\\\-–—\s]/.test(remainder)) return null;

  return remainder;
}

function headingVersion(content: string, packageName: string): string | null {
  const prepared = prepareHeading(content, packageName);
  const match = prepared.value.match(VERSION_PATTERN);

  if (match === null || match.index !== 0) return null;
  const rawVersion = match[0];
  const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

  if (!isExactSemver(version) || versionRemainder(prepared.value, rawVersion, prepared.bracketed) === null) return null;

  return version;
}

function isUnreleasedHeading(content: string): boolean {
  return /^\[?unreleased(?:\]|\b)/i.test(content.trim());
}

function fenceLine(value: string): FenceLine | null {
  const match = value.match(/^ {0,3}(`{3,}|~{3,})/);

  if (match === null) return null;
  const marker = match[1]?.[0];

  if (marker !== '`' && marker !== '~') return null;

  return { marker, length: match[1]?.length ?? 0 };
}

function atxHeading(current: string, line: number, packageName: string): { heading: Heading; nextLine: number } | null {
  const match = current.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|[ \t]*)$/);

  if (match === null) return null;
  const content = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();

  return {
    heading: {
      line,
      level: match[1]?.length ?? 6,
      version: headingVersion(content, packageName),
      unreleased: isUnreleasedHeading(content),
    },
    nextLine: line,
  };
}

function setextHeading(
  lines: readonly string[],
  line: number,
  packageName: string,
): { heading: Heading; nextLine: number } | null {
  const current = lines[line] ?? '';
  const underline = lines[line + 1]?.match(/^ {0,3}(=+|-+)[ \t]*$/);

  if (underline == null || current.trim() === '') return null;
  const content = current.trim();

  return {
    heading: {
      line,
      level: underline[1]?.[0] === '=' ? 1 : 2,
      version: headingVersion(content, packageName),
      unreleased: isUnreleasedHeading(content),
    },
    nextLine: line + 1,
  };
}

function parseHeadingLine(
  lines: readonly string[],
  line: number,
  packageName: string,
): { heading: Heading; nextLine: number } | null {
  return atxHeading(lines[line] ?? '', line, packageName) ?? setextHeading(lines, line, packageName);
}

type FenceState = { fence: Fence | null; length: number };

function updateFence(current: Fence | null, length: number, line: FenceLine): FenceState {
  if (current === null) return { fence: line.marker, length: line.length };

  if (line.marker === current && line.length >= length) return { fence: null, length: 0 };

  return { fence: current, length };
}

function appendHeading(lines: readonly string[], line: number, packageName: string, headings: Heading[]): number {
  const heading = parseHeadingLine(lines, line, packageName);

  if (heading === null) return line;
  headings.push(heading.heading);

  return heading.nextLine;
}

function parseHeadings(body: string, packageName: string): Heading[] {
  const lines = body.split(/\r\n|\n|\r/);
  const headings: Heading[] = [];
  let fence: Fence | null = null;
  let fenceLength = 0;

  for (let line = 0; line < lines.length; line += 1) {
    const marker = fenceLine(lines[line] ?? '');

    if (marker !== null) {
      const updated = updateFence(fence, fenceLength, marker);
      fence = updated.fence;
      fenceLength = updated.length;
      continue;
    }

    if (fence !== null) continue;
    line = appendHeading(lines, line, packageName, headings);
  }

  return headings;
}

const isBoundary = (heading: Heading, selected: Heading): boolean =>
  heading.unreleased || heading.level <= selected.level;

function sectionEnd(headings: readonly Heading[], selected: Heading, lineCount: number): number {
  return headings.find((heading) => heading.line > selected.line && isBoundary(heading, selected))?.line ?? lineCount;
}

type ChangelogExtraction = { sections: ChangelogSection[]; reason: string | null };

function extractChangelogSections(body: string, packageName: string, from: string, to: string): ChangelogExtraction {
  const lines = body.split(/\r\n|\n|\r/);
  const headings = parseHeadings(body, packageName);
  const versionHeadings = headings.filter((heading) => heading.version !== null);

  if (versionHeadings.length === 0)
    return { sections: [], reason: 'changelog has no unambiguous exact-version headings' };

  const selected = versionHeadings.filter(
    (heading): heading is Heading & { version: string } =>
      heading.version !== null && compareSemver(heading.version, from) > 0 && compareSemver(heading.version, to) <= 0,
  );

  if (selected.length === 0)
    return { sections: [], reason: 'changelog has no version-matched sections in the requested interval' };

  const sections: ChangelogSection[] = [];

  for (const heading of selected) {
    const text = lines
      .slice(heading.line, sectionEnd(headings, heading, lines.length))
      .join('\n')
      .trim();

    if (text !== '') sections.push({ version: heading.version, text });
  }

  return { sections, reason: sections.length === 0 ? 'version-matched changelog sections were empty' : null };
}

function sortMaintainerRecords(records: readonly MaintainerRecord[]): MaintainerRecord[] {
  const originRank: Record<MaintainerRecord['origin'], number> = {
    release: 0,
    'repository-changelog': 1,
    'published-changelog': 2,
  };

  return [...records].sort((left, right) => {
    const version = compareSemver(left.version, right.version);

    if (version !== 0) return version;
    const text = left.text.localeCompare(right.text);

    if (text !== 0) return text;
    const origin = originRank[left.origin] - originRank[right.origin];

    if (origin !== 0) return origin;

    return left.url.localeCompare(right.url);
  });
}

function mergeMaintainerRecords(records: readonly MaintainerRecord[]): MaintainerRecord[] {
  const merged = new Map<string, MaintainerRecord>();

  for (const record of sortMaintainerRecords(records)) {
    const key = `${record.version}\u0000${record.text}`;
    const existing = merged.get(key);

    if (existing === undefined) {
      merged.set(key, { ...record });
      continue;
    }

    existing.label = `${existing.label}; ${record.label}`;

    if (existing.url !== record.url) existing.url = `${existing.url}\u0000${record.url}`;
    existing.truncated ||= record.truncated;
  }

  return [...merged.values()];
}

function changelogRecords(
  document: ChangelogDocument,
  input: BriefingInput,
  addGap: (gap: string) => void,
): MaintainerRecord[] {
  if (document.inputTruncated) addGap(`${document.label} was truncated during artifact inspection`);

  if (document.body.trim() === '') {
    addGap(`${document.label} is empty`);

    return [];
  }

  const extracted = extractChangelogSections(document.body, input.packageName, input.from.version, input.to.version);

  if (extracted.reason !== null) addGap(`${document.label}: ${extracted.reason}`);

  return extracted.sections.map((section) => {
    const excerpt = boundedText(section.text, MAX_MAINTAINER_BYTES);

    if (excerpt.truncated) addGap(`${document.label}, version ${section.version} was truncated to 4 KiB`);

    return {
      version: section.version,
      text: excerpt.text,
      label: `${document.label}, version ${section.version}`,
      url: document.url,
      origin: document.label.startsWith('Published changelog') ? 'published-changelog' : 'repository-changelog',
      truncated: excerpt.truncated || document.inputTruncated,
    } satisfies MaintainerRecord;
  });
}

function releaseRecords(input: BriefingInput, addGap: (gap: string) => void): MaintainerRecord[] {
  const releases = [...input.releaseNotes.releases]
    .filter(
      (release) =>
        isExactSemver(release.version) &&
        compareSemver(release.version, input.from.version) > 0 &&
        compareSemver(release.version, input.to.version) <= 0,
    )
    .sort((left, right) => {
      const version = compareSemver(left.version, right.version);

      if (version !== 0) return version;
      const url = left.url.localeCompare(right.url);

      if (url !== 0) return url;

      return left.body.localeCompare(right.body);
    });

  return releases.flatMap((release) => {
    if (release.body.trim() === '') {
      addGap(`GitHub release ${release.version} has no release body`);

      return [];
    }

    const excerpt = boundedText(release.body, MAX_MAINTAINER_BYTES);

    if (excerpt.truncated) addGap(`GitHub release ${release.version} was truncated to 4 KiB`);

    return [
      {
        version: release.version,
        text: excerpt.text,
        label: `GitHub release ${release.version}${release.tag ? ` (${release.tag})` : ''}`,
        url: release.url,
        origin: 'release' as const,
        truncated: excerpt.truncated,
      },
    ];
  });
}

function changelogDocuments(input: BriefingInput): ChangelogDocument[] {
  const repository = input.releaseNotes.changelog;

  const documents: ChangelogDocument[] =
    repository === null
      ? []
      : [
          {
            label: `Repository changelog ${repository.path} @ ${repository.ref}`,
            url: repository.url,
            body: repository.body,
            inputTruncated: false,
          },
        ];

  return [
    ...documents,
    ...input.to.tarball.changelogs.map((changelog) => ({
      label: `Published changelog ${changelog.path} (${input.to.version})`,
      url: input.to.tarball.url,
      body: changelog.body,
      inputTruncated: changelog.truncated,
    })),
  ];
}

function toMaintainerCandidates(records: readonly MaintainerRecord[]): BriefingEvidenceCandidate[] {
  const counters = new Map<string, number>();

  return records.map((record) => {
    const base = record.origin === 'release' ? `release.${record.version}` : `changelog.${record.version}`;
    const count = (counters.get(base) ?? 0) + 1;
    counters.set(base, count);

    const source = {
      id: count === 1 ? base : `${base}.${count}`,
      kind: 'maintainer' as const,
      label: record.label,
      urls: unique(record.url.split('\u0000')),
      text: record.text,
    };

    const candidate: BriefingEvidenceCandidate = { source, priority: 4 };

    if (record.truncated) candidate.truncated = true;

    return candidate;
  });
}

export function buildMaintainerCandidates(
  input: BriefingInput,
  addGap: (gap: string) => void,
): BriefingEvidenceCandidate[] {
  const records = [
    ...releaseRecords(input, addGap),
    ...changelogDocuments(input).flatMap((document) => changelogRecords(document, input, addGap)),
  ];

  return toMaintainerCandidates(mergeMaintainerRecords(records));
}
