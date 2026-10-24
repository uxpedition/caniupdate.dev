import { describe, expect, it } from 'vitest';

import type { DeclaredPackageVersion } from '#shared/comparison/comparison.defs';

import { buildPackageSurface } from './packageSurface';

type ModuleFormat = DeclaredPackageVersion['moduleFormat'];

const version = (moduleFormat: ModuleFormat): DeclaredPackageVersion => ({
  name: '@scope/pkg',
  version: '1.0.0',
  dist: { tarball: 'https://registry.npmjs.org/pkg.tgz' },
  licenses: [],
  deprecated: false,
  engines: {},
  dependencies: {},
  optionalDependencies: {},
  peerDependencies: {},
  optionalPeers: [],
  installScripts: [],
  installScriptCommands: {},
  moduleFormat,
});

const compare = (from: ModuleFormat, to: ModuleFormat) => buildPackageSurface(version(from), version(to));

describe('package surface metadata comparison', () => {
  it('distinguishes an absent map from a blocked root without calling deep imports removed', () => {
    const result = compare({}, { exports: { '.': null, './ast/clone': './clone.js' } });
    expect(result.entries[0]?.from.label).toBe('No export map');
    expect(result.entries[0]?.to.label).toBe('Blocked');
    expect(result.entries.find((entry) => entry.key === './ast')?.kind).toBe('group');
    expect(result.entries.find((entry) => entry.key === './ast/clone')?.path).toBe('@scope/pkg/ast/clone');
  });

  it('preserves conditions and fallback order rather than promising a selected runtime target', () => {
    const result = compare(
      {},
      {
        exports: {
          '.': {
            browser: { import: './browser.mjs' },
            import: ['./first.mjs', './fallback.mjs'],
            require: './index.cjs',
          },
        },
      },
    );

    const root = result.entries[0];
    expect(root?.to.import.branches.map((branch) => branch.target)).toEqual([
      './browser.mjs',
      './first.mjs',
      './fallback.mjs',
    ]);
    expect(root?.to.import.branches[0]?.conditions).toEqual(['browser', 'import']);
    expect(root?.to.require.branches.map((branch) => branch.target)).toEqual(['./index.cjs']);
    expect(root?.to.import.label).toBe('Conditional');
  });

  it('detects precedence changes even if target filenames stay the same', () => {
    const result = compare(
      { exports: { default: './fallback.js', import: './esm.mjs' } },
      { exports: { import: './esm.mjs', default: './fallback.js' } },
    );

    expect(result.summary).toMatchObject({ status: 'available', changed: 1, same: 0 });
  });

  it('does not claim require is unsupported merely because the target is ESM', () => {
    const root = compare({}, { type: 'module', exports: './index.js' }).entries[0];
    expect(root?.to.require.label).toBe('Runtime-dependent');
    expect(root?.to.require.example).toBe('const pkg = require("@scope/pkg");');
  });

  it('does not offer a literal wildcard or JSON import as executable JavaScript', () => {
    const result = compare({}, { exports: { './*': './dist/*.js', './package.json': './package.json' } });
    expect(result.entries.find((entry) => entry.key === './*')?.to.import.example).toBeNull();
    expect(result.entries.find((entry) => entry.key === './package.json')?.to.import.example).toBeNull();
    expect(result.entries.find((entry) => entry.key === './*')?.kind).toBe('pattern');
  });

  it('keeps types conditions separate from runtime targets and preserves compiler mappings', () => {
    const result = compare(
      {},
      {
        exports: { '.': { types: './index.d.ts', import: './index.mjs' } },
        typesVersions: { '<5.0': { '*': ['compat/*', 'fallback/*'] } },
      },
    );

    expect(result.entries[0]?.to.import.branches.map((branch) => branch.target)).toEqual(['./index.mjs']);
    expect(result.entries[0]?.to.types.map((branch) => branch.target)).toEqual(['./index.d.ts']);
    expect(result.to.typeMappings).toEqual([{ compiler: '<5.0', path: '*', targets: ['compat/*', 'fallback/*'] }]);
  });

  it('does not say a wildcard-covered path is unmapped when the other version lists it explicitly', () => {
    const result = compare({ exports: { './*': './lib/*.js' } }, { exports: { './ast': './ast.js' } });
    expect(result.entries.find((entry) => entry.key === './ast')?.from.label).toBe('Pattern may apply');
  });

  it('keeps null, empty, and unrecognized declarations distinct', () => {
    expect(compare({}, { exports: null }).entries[0]?.to.label).toBe('Blocked');
    expect(compare({}, { exports: {} }).entries[0]?.to.label).toBe('Not mapped');
    expect(compare({}, { exports: 42 }).entries[0]?.to.label).toBe('Cannot determine');
  });

  it('does not turn condition names in a malformed mixed export map into invented import paths', () => {
    const result = compare({}, { exports: { './ast': './ast.js', default: './index.js' } });
    expect(result.entries.map((entry) => entry.path)).toEqual(['@scope/pkg']);
    expect(result.entries[0]?.to.label).toBe('Cannot determine');
    expect(result.entries[0]?.to.import.example).toBeNull();
  });

  it('counts same, changed, new, and removed exports without counting blocked paths', () => {
    const result = compare(
      {
        exports: {
          '.': './index.js',
          './same': './same.js',
          './change': './old.js',
          './remove': './remove.js',
          './blocked': null,
        },
      },
      {
        exports: {
          '.': './index.js',
          './same': './same.js',
          './change': './new.js',
          './add': './add.js',
          './blocked': null,
        },
      },
    );

    expect(result.summary).toEqual({ status: 'available', same: 2, changed: 1, added: 1, removed: 1 });
    expect(result.from.exportCount).toBe(4);
    expect(result.to.exportCount).toBe(4);
    expect(result.to.declaredKeys).not.toContain('./remove');
  });

  it('does not invent zero exports or change counts for a release without an export map', () => {
    const result = compare({ main: './index.js' }, { exports: { '.': './index.js', './fs': './fs.js' } });
    expect(result.from.exportCount).toBeNull();
    expect(result.to.exportCount).toBe(2);
    expect(result.summary.status).toBe('unavailable');
  });

  it('counts patterns separately from explicit paths and leaves malformed inventories uncertain', () => {
    const patterned = compare(
      { exports: {} },
      { exports: { './ast/*': './ast/*.js', './ast/clone': './clone.js', './blocked': null } },
    );

    expect(patterned.to.exportCount).toBe(1);
    expect(patterned.to.patternCount).toBe(1);
    expect(compare({ exports: {} }, { exports: 42 }).to.exportCount).toBeNull();
  });

  it('treats a blocked path becoming available as a new export rather than a changed export', () => {
    const result = compare({ exports: null }, { exports: './index.cjs' });
    expect(result.from.exportCount).toBe(0);
    expect(result.to.exportCount).toBe(1);
    expect(result.summary).toEqual({ status: 'available', same: 0, changed: 0, added: 1, removed: 0 });
  });
});

describe('package surface measured types', () => {
  const from = version({});
  const to = { ...version({}), version: '2.0.0' };

  const measured = {
    packageName: from.name,
    from: {
      name: from.name,
      version: from.version,
      bundledTypes: { status: 'available', matchedTargetCount: 0 } as const,
    },
    to: { name: to.name, version: to.version, bundledTypes: { status: 'available', matchedTargetCount: 1 } as const },
  };

  it('keeps pending metadata immediate and upgrades only the matching measured version', () => {
    expect(buildPackageSurface(from, to).to.badges).toEqual([]);
    const result = buildPackageSurface(from, to, measured);
    expect(result.from.badges).toEqual([]);
    expect(result.to.badges).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'possible', source: 'archive' }),
    ]);
  });

  it('ignores cached measurements for another package, release, or comparison direction', () => {
    for (const stale of [
      { ...measured, packageName: 'different-package' },
      { ...measured, from: { ...measured.from, version: '0.1.0' } },
      { ...measured, to: { ...measured.to, name: 'different-package' } },
      { ...measured, from: measured.to, to: measured.from },
    ]) {
      const result = buildPackageSurface(from, to, stale);
      expect(result.from.badges).toEqual([]);
      expect(result.to.badges).toEqual([]);
    }
  });
});
