import { describe, expect, it } from 'vitest';

import type { BriefingInput } from '../../shared/briefing.defs';
import type { ComparisonVersion } from '../../shared/comparison.defs';
import type { PackageReleaseNotes } from '../../shared/github.defs';
import type { PackageAdvisory } from '../../shared/osv.defs';
import { toPackageVersion } from '../../shared/package.defs';
import { buildBriefingEvidence } from './packageBriefingEvidence';
import { comparePackages } from './packageComparison';

// Keep the fixture close to the comparison boundary: briefing packaging must consume computed facts rather than
// inspect manifests or derive a second comparison.
function version(version: string, overrides: Partial<ComparisonVersion> = {}): ComparisonVersion {
  return {
    ...toPackageVersion({
      name: 'widget',
      version,
      dist: {
        tarball: `https://registry.npmjs.org/widget/-/widget-${version}.tgz`,
        shasum: 'abc',
      },
    }),
    vulnerabilities: { status: 'available', count: 0, advisories: [] },
    bundleSize: {
      provider: 'bundlephobia',
      url: `https://bundlephobia.com/api/size?package=widget%40${version}`,
      status: 'unavailable',
      size: null,
      gzip: null,
    },
    tarball: {
      status: 'unavailable',
      url: `https://registry.npmjs.org/widget/-/widget-${version}.tgz`,
      reasons: [],
      files: [],
      changelogs: [],
    },
    ...overrides,
  };
}

function notes(overrides: Partial<PackageReleaseNotes> = {}): PackageReleaseNotes {
  return {
    status: 'available',
    reasons: [],
    releases: [],
    changelog: null,
    ...overrides,
  };
}

function input(
  from: ComparisonVersion,
  to: ComparisonVersion,
  releaseNotes: PackageReleaseNotes = notes(),
): BriefingInput {
  return {
    packageName: 'widget',
    from,
    to,
    comparison: comparePackages(from, to),
    releaseNotes,
  };
}

describe('buildBriefingEvidence', () => {
  it('keeps only version-matched changelog sections and does not mutate the body', () => {
    const body = [
      '# Changelog',
      '',
      '## Unreleased',
      'Do not attach this unreleased work.',
      '',
      '## 3.0.0',
      'Later release, outside the target.',
      '',
      '2.0.0',
      '-----',
      'Target action: update the adapter.',
      '',
      '## 1.0.0',
      'The selected from version is excluded.',
    ].join('\n');
    const releaseNotes = notes({
      changelog: {
        body,
        path: 'docs/CHANGELOG.md',
        ref: 'target-commit',
        url: 'https://github.com/acme/widget/blob/target-commit/docs/CHANGELOG.md',
      },
    });
    const result = buildBriefingEvidence(input(version('1.0.0'), version('2.0.0'), releaseNotes));
    const changelog = result.sources.find((source) => source.kind === 'maintainer');

    expect(changelog?.label).toContain('docs/CHANGELOG.md @ target-commit');
    expect(changelog?.urls).toEqual(['https://github.com/acme/widget/blob/target-commit/docs/CHANGELOG.md']);
    expect(changelog?.text).toContain('Target action: update the adapter.');
    expect(changelog?.text).not.toContain('Do not attach this unreleased work.');
    expect(changelog?.text).not.toContain('Later release, outside the target.');
    expect(changelog?.text).not.toContain('The selected from version is excluded.');
    expect(releaseNotes.changelog?.body).toBe(body);
  });

  it('defensively filters release bodies to the semver interval', () => {
    const releaseNotes = notes({
      releases: [
        {
          version: '1.0.0',
          tag: 'v1.0.0',
          name: 'from',
          body: 'From release, excluded.',
          url: 'https://github.com/acme/widget/releases/tag/v1.0.0',
        },
        {
          version: '2.0.0',
          tag: 'v2.0.0',
          name: 'target',
          body: 'Target release action.',
          url: 'https://github.com/acme/widget/releases/tag/v2.0.0',
        },
        {
          version: '3.0.0',
          tag: 'v3.0.0',
          name: 'later',
          body: 'Later release, excluded.',
          url: 'https://github.com/acme/widget/releases/tag/v3.0.0',
        },
        {
          version: 'not-a-version',
          tag: 'unreleased',
          name: 'unreleased',
          body: 'Unreleased text, excluded.',
          url: 'https://github.com/acme/widget/releases/tag/unreleased',
        },
      ],
    });
    const result = buildBriefingEvidence(input(version('1.0.0'), version('2.0.0'), releaseNotes));
    const release = result.sources.find((source) => source.id === 'release.2.0.0');

    expect(release?.text).toBe('Target release action.');
    expect(release?.urls).toEqual(['https://github.com/acme/widget/releases/tag/v2.0.0']);
    expect(result.sources.some((source) => source.text.includes('From release, excluded.'))).toBe(false);
    expect(result.sources.some((source) => source.text.includes('Later release, excluded.'))).toBe(false);
    expect(result.sources.some((source) => source.text.includes('Unreleased text, excluded.'))).toBe(false);
  });

  it('rejects ambiguous version headings instead of guessing a release section', () => {
    const releaseNotes = notes({
      changelog: {
        body: ['# Changes', '', '## 2.0.0 / 3.0.0', 'Ambiguous range heading.', '', '## 1.0.0', 'From only.'].join(
          '\n',
        ),
        path: 'CHANGELOG.md',
        ref: 'target',
        url: 'https://github.com/acme/widget/blob/target/CHANGELOG.md',
      },
    });
    const result = buildBriefingEvidence(input(version('1.0.0'), version('2.0.0'), releaseNotes));

    expect(result.sources.filter((source) => source.kind === 'maintainer')).toHaveLength(0);
    expect(result.gaps.some((gap) => gap.includes('no version-matched sections'))).toBe(true);
  });

  it('keeps the packet UTF-8 bounded and records omitted and partial evidence', () => {
    const from = version('1.0.0');
    const to = version('2.0.0');
    const base = comparePackages(from, to);
    const hugeComparison = {
      ...base,
      dependencies: Array.from({ length: 30_000 }, (_, index) => ({
        name: `dependency-${index}`,
        kind: 'changed' as const,
        from: { category: 'runtime' as const, range: '^1.0.0' },
        to: { category: 'runtime' as const, range: `^${index}.0.0` },
      })),
    };
    const longRelease = 'Release details 🚀 '.repeat(2_000);
    const releaseNotes = notes({
      releases: [
        {
          version: '2.0.0',
          tag: 'v2.0.0',
          name: '2.0.0',
          body: longRelease,
          url: 'https://github.com/acme/widget/releases/tag/v2.0.0',
        },
      ],
    });
    const evidenceInput: BriefingInput = { packageName: 'widget', from, to, comparison: hugeComparison, releaseNotes };
    const before = JSON.stringify(evidenceInput);
    const result = buildBriefingEvidence(evidenceInput);
    const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    const coverage = result.sources.find((source) => source.id === 'coverage');
    const release = result.sources.find((source) => source.id.startsWith('release.'));

    expect(bytes).toBeLessThanOrEqual(48 * 1024);
    expect(result.sources.length).toBeLessThanOrEqual(64);
    expect(coverage?.text).toMatch(/"omitted":\{"sourceIds":\[[^\]]*comparison\.dependencies/);
    expect(coverage?.text).toMatch(/"truncated":\{"sourceIds":\[[^\]]*release\.2\.0\.0/);
    expect(new TextEncoder().encode(release?.text ?? '').byteLength).toBeLessThanOrEqual(4096);
    expect(result.gaps.some((gap) => gap.includes('omitted'))).toBe(true);
    expect(JSON.stringify(evidenceInput)).toBe(before);
  });

  it('retains advisory matches and summaries when provider detail records exceed the packet budget', () => {
    const advisory: PackageAdvisory = {
      id: 'GHSA-example',
      url: 'https://osv.dev/vulnerability/GHSA-example',
      detailsStatus: 'available',
      modified: '2026-01-01T00:00:00Z',
      summary: 'Development server can expose files outside its root.',
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N' }],
      references: Array.from({ length: 1_000 }, (_, index) => ({
        type: 'WEB',
        url: `https://example.com/security/references/${index}`,
      })),
      affected: [{ package: { ecosystem: 'npm', name: 'widget' }, versions: ['1.0.0', '2.0.0'] }],
    };
    const vulnerabilities = { status: 'available' as const, count: 1, advisories: [advisory] };
    const result = buildBriefingEvidence(
      input(version('1.0.0', { vulnerabilities }), version('2.0.0', { vulnerabilities })),
    );
    const source = result.sources.find(({ id }) => id === 'comparison.advisories');

    expect(JSON.parse(source?.text ?? 'null')).toMatchObject({
      status: 'available',
      fromOnly: [],
      toOnly: [],
      both: [
        {
          ids: ['GHSA-example'],
          from: [{ id: 'GHSA-example', summary: 'Development server can expose files outside its root.' }],
          to: [
            {
              id: 'GHSA-example',
              severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N' }],
            },
          ],
        },
      ],
    });
    expect(source?.urls).toEqual(['https://osv.dev/vulnerability/GHSA-example']);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(48 * 1024);
  });

  it('keeps smaller compatibility facts when a high-priority source cannot fit even by itself', () => {
    const advisory: PackageAdvisory = {
      id: 'GHSA-oversized',
      url: 'https://osv.dev/vulnerability/GHSA-oversized',
      detailsStatus: 'available',
      modified: '2026-01-01T00:00:00Z',
      summary: 'Oversized provider summary. '.repeat(3_000),
    };
    const result = buildBriefingEvidence(
      input(
        version('1.0.0', { engines: { node: '>=18' } }),
        version('2.0.0', {
          engines: { node: '>=20' },
          vulnerabilities: { status: 'available', count: 1, advisories: [advisory] },
        }),
      ),
    );
    const node = result.sources.find(({ id }) => id === 'comparison.node');
    const coverage = result.sources.find(({ id }) => id === 'coverage');

    expect(JSON.parse(node?.text ?? 'null')).toMatchObject({ changed: true, from: '>=18', to: '>=20' });
    expect(JSON.parse(coverage?.text ?? 'null')).toMatchObject({
      omitted: { sourceIds: ['comparison.advisories'], count: 1 },
    });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(48 * 1024);
  });

  it('numbers each packed source by its packet position, with coverage last', () => {
    const result = buildBriefingEvidence(
      input(version('1.0.0', { engines: { node: '>=18' } }), version('2.0.0', { engines: { node: '>=20' } })),
    );

    expect(result.sources.length).toBeGreaterThan(1);
    expect(result.sources.map(({ number }) => number)).toEqual(
      Array.from({ length: result.sources.length }, (_, position) => position + 1),
    );
    expect(result.sources.at(-1)).toMatchObject({ id: 'coverage', number: result.sources.length });
  });

  it('rejects malformed or oversized identity instead of exceeding the packet bound', () => {
    const from = version('1.0.0');
    const to = version('2.0.0');
    const normal = input(from, to);

    expect(() => buildBriefingEvidence({ ...normal, packageName: 'widget'.repeat(10_000) })).toThrow(
      'Briefing identity exceeds evidence packet bounds',
    );
    expect(() => buildBriefingEvidence({ ...normal, packageName: '' })).toThrow('Briefing identity is malformed');
    expect(() => buildBriefingEvidence({ ...normal, from: { ...from, version: '' } })).toThrow(
      'Briefing identity is malformed',
    );
  });

  it('retains uncertain advisory groups and their incomplete-coverage caveat', () => {
    const advisory: PackageAdvisory = {
      id: 'GHSA-example',
      url: 'https://osv.dev/vulnerability/GHSA-example',
      detailsStatus: 'unavailable',
    };
    const from = version('1.0.0', {
      vulnerabilities: { status: 'available', count: 1, advisories: [advisory] },
    });
    const to = version('2.0.0', { vulnerabilities: { status: 'partial', count: 0, advisories: [] } });
    const result = buildBriefingEvidence(input(from, to));
    const advisories = result.sources.find((source) => source.id === 'comparison.advisories');

    expect(advisories?.text).toContain('"status":"partial"');
    expect(advisories?.text).toContain('"uncertain":[{"ids":["GHSA-example"]');
    expect(advisories?.urls).toEqual(['https://osv.dev/vulnerability/GHSA-example']);
    expect(result.gaps.some((gap) => gap.includes('absence is not proof of resolution'))).toBe(true);
  });
});
