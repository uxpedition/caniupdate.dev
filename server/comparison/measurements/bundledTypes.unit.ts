import { describe, expect, it } from 'vitest';

import type { PackageTarball, PublishedFile } from '#shared/comparison/evidence/tarball.defs';

import { getBundledTypeEvidence } from './bundledTypes';

const archive = (paths: readonly string[], status: PackageTarball['status'] = 'available'): PackageTarball => ({
  status,
  reasons: [],
  url: 'https://registry.npmjs.org/example.tgz',
  changelogs: [],
  installInspection: {
    analysis: { status: 'unavailable', reasons: [], uninspectedPackages: [], scripts: [], findings: [] },
    files: [],
  },
  files: paths.map((path) => ({ path, type: 'file', size: 1, sha256: 'digest' })),
});

describe('shipped declarations matching JavaScript entry targets', () => {
  it('matches actual exported targets rather than public subpath names', () => {
    const result = getBundledTypeEvidence(
      { exports: { './parser': './dist/internal/parse.js' } },
      archive(['dist/internal/parse.js', 'dist/internal/parse.d.ts', 'parser.d.ts']),
    );

    expect(result).toEqual({ status: 'available', matchedTargetCount: 1 });
    expect(
      getBundledTypeEvidence(
        { exports: { './parser': './dist/internal/parse.js' } },
        archive(['dist/internal/parse.js', 'parser.d.ts']),
      ),
    ).toEqual({ status: 'available', matchedTargetCount: 0 });
  });

  it('uses format-specific declaration extensions and deduplicates repeated runtime targets', () => {
    const result = getBundledTypeEvidence(
      {
        exports: {
          '.': { import: './esm.mjs', require: './common.cjs' },
          './alias': './esm.mjs',
        },
      },
      archive(['esm.mjs', 'esm.d.mts', 'common.cjs', 'common.d.cts']),
    );

    expect(result).toEqual({ status: 'available', matchedTargetCount: 2 });
    expect(getBundledTypeEvidence({ exports: './esm.mjs' }, archive(['esm.mjs', 'esm.d.ts']))).toEqual({
      status: 'available',
      matchedTargetCount: 0,
    });
  });

  it('accepts legacy main/module targets only without an export map', () => {
    const files = archive(['lib/main.js', 'lib/main.d.ts', 'esm.mjs', 'esm.d.mts']);
    expect(getBundledTypeEvidence({ main: 'lib/main.js', module: './esm.mjs' }, files)).toEqual({
      status: 'available',
      matchedTargetCount: 2,
    });
    expect(getBundledTypeEvidence({ main: 'lib/main.js', exports: { '.': null } }, files)).toEqual({
      status: 'available',
      matchedTargetCount: 0,
    });
  });

  it('ignores wildcard keys even when their destination is concrete and nested type-only conditions', () => {
    expect(
      getBundledTypeEvidence(
        {
          exports: {
            './*': './fixed.js',
            '.': { import: { 'types@>=5': './only.js', default: null } },
          },
        },
        archive(['fixed.js', 'fixed.d.ts', 'only.js', 'only.d.ts']),
      ),
    ).toEqual({ status: 'available', matchedTargetCount: 0 });
  });

  it('examines conditional fallback arrays without claiming that any branch resolves', () => {
    expect(
      getBundledTypeEvidence(
        { exports: { '.': { browser: ['./missing.js', './index.js'] } } },
        archive(['index.js', 'index.d.ts']),
      ),
    ).toEqual({ status: 'available', matchedTargetCount: 1 });
  });

  it('does not expand wildcard exports or use declarations behind types-only conditions', () => {
    expect(
      getBundledTypeEvidence(
        { exports: { './*': './dist/*.js', '.': { types: './only.js', require: null } } },
        archive(['dist/a.js', 'dist/a.d.ts', 'only.js', 'only.d.ts']),
      ),
    ).toEqual({ status: 'available', matchedTargetCount: 0 });
  });

  it('requires both target and declaration to be regular files and does not follow links', () => {
    const files = archive(['index.js']);

    const linked: PublishedFile = {
      path: 'index.d.ts',
      type: 'symlink',
      size: 0,
      sha256: null,
      linkTarget: 'hidden.d.ts',
    };

    expect(getBundledTypeEvidence({ exports: './index.js' }, { ...files, files: [...files.files, linked] })).toEqual({
      status: 'available',
      matchedTargetCount: 0,
    });
    expect(getBundledTypeEvidence({ exports: './missing.js' }, archive(['missing.d.ts']))).toEqual({
      status: 'available',
      matchedTargetCount: 0,
    });
  });

  it('uses complete inventories with partial changelog evidence but preserves unavailable inspection', () => {
    expect(getBundledTypeEvidence({ exports: './index.js' }, archive(['index.js', 'index.d.ts'], 'partial'))).toEqual({
      status: 'partial',
      matchedTargetCount: 1,
    });
    expect(getBundledTypeEvidence({ exports: './index.js' }, archive([], 'unavailable'))).toEqual({
      status: 'unavailable',
      matchedTargetCount: null,
    });
  });
});
