import { describe, expect, it } from 'vitest';

import { packageSurfaceBadges, typesPackageName, withExternalTypes } from './packageSurfaceBadges';

describe('package format evidence', () => {
  it('does not confuse importing CommonJS with shipping ESM', () => {
    expect(packageSurfaceBadges({ exports: { import: './index.cjs', require: null } })).toEqual([
      expect.objectContaining({ name: 'CJS', confidence: 'strong' }),
    ]);
  });

  it('does not treat a blocked condition or JSON as format evidence', () => {
    expect(packageSurfaceBadges({ exports: { import: null, require: null, default: './package.json' } })).toEqual([]);
  });

  it('recognizes explicit formats across subpaths without promising both for each path', () => {
    expect(packageSurfaceBadges({ exports: { './a': './a.mjs', './b': './b.cjs' } })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'strong' }),
      expect.objectContaining({ name: 'CJS', confidence: 'strong' }),
    ]);
  });

  it('uses explicit package type for js targets but not for conflicting extensions', () => {
    expect(packageSurfaceBadges({ type: 'module', main: './index.js' })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'strong' }),
    ]);
    expect(packageSurfaceBadges({ type: 'module', main: './index.cjs' })).toEqual([
      expect.objectContaining({ name: 'CJS', confidence: 'strong' }),
    ]);
  });

  it('keeps conventional legacy and conditional hints uncertain', () => {
    expect(packageSurfaceBadges({ main: './index.js', module: './esm.js' })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'possible' }),
      expect.objectContaining({ name: 'CJS', confidence: 'possible' }),
    ]);
    expect(packageSurfaceBadges({ exports: { import: './index.js', require: './legacy.js' } })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'possible' }),
      expect.objectContaining({ name: 'CJS', confidence: 'possible' }),
    ]);
  });

  it('ignores legacy main when an export map replaces it', () => {
    expect(packageSurfaceBadges({ main: './legacy.cjs', exports: './index.mjs' })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'strong' }),
    ]);
  });

  it('does not turn missing declarations into a default CJS badge', () => {
    expect(packageSurfaceBadges({})).toEqual([]);
    expect(packageSurfaceBadges({ type: 'module' })).toEqual([
      expect.objectContaining({ name: 'ESM', confidence: 'possible' }),
    ]);
  });

  it('keeps declaration files and blocked type routes out of runtime formats', () => {
    expect(packageSurfaceBadges({ exports: { types: './index.d.mts', require: null } })).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'strong' }),
    ]);
    expect(packageSurfaceBadges({ exports: { types: null } })).toEqual([]);
  });

  it('distinguishes declared types from compiler mapping hints', () => {
    expect(packageSurfaceBadges({ typings: './index.d.ts' })).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'strong' }),
    ]);
    expect(packageSurfaceBadges({ typesVersions: { '*': { '*': ['types/*'] } } })).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'possible' }),
    ]);
    expect(packageSurfaceBadges({ types: '', typesVersions: {} })).toEqual([]);
  });
});

describe('bundled declaration file evidence', () => {
  it('keeps adjacent shipped declarations uncertain and does not replace a declared types tick', () => {
    const shipped = { status: 'available', matchedTargetCount: 2 } as const;
    expect(packageSurfaceBadges({}, shipped)).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'possible', source: 'archive' }),
    ]);
    expect(packageSurfaceBadges({ types: './index.d.ts' }, shipped)).toEqual(
      packageSurfaceBadges({ types: './index.d.ts' }),
    );
  });

  it('does not add a types badge for missing, unavailable, or nonmatching archive evidence', () => {
    expect(packageSurfaceBadges({}, { status: 'available', matchedTargetCount: 0 })).toEqual([]);
    expect(packageSurfaceBadges({}, { status: 'unavailable', matchedTargetCount: null })).toEqual([]);
    expect(packageSurfaceBadges({})).toEqual([]);
    expect(packageSurfaceBadges({}, { status: 'partial', matchedTargetCount: 1 })).toEqual([
      expect.objectContaining({ name: 'TYPES', confidence: 'possible', source: 'archive' }),
    ]);
  });

  it('prefers exact-release shipped declarations over deprecated external types', () => {
    const badges = packageSurfaceBadges({}, { status: 'available', matchedTargetCount: 1 });

    const result = withExternalTypes(
      badges,
      {
        name: '@types/example',
        latestRelease: { version: '2.0.0', deprecated: 'Use bundled types.' },
      },
      '3.0.0',
    );

    expect(result).toEqual([expect.objectContaining({ name: 'TYPES', confidence: 'possible', source: 'archive' })]);
    expect(result[0]?.warning).toBeUndefined();
    expect(result[0]?.href).toBeUndefined();
  });
});

describe('external types evidence', () => {
  it('maps scoped packages to DefinitelyTyped naming and avoids types-of-types', () => {
    expect(typesPackageName('@scope/pkg')).toBe('@types/scope__pkg');
    expect(typesPackageName('react')).toBe('@types/react');
    expect(typesPackageName('@types/react')).toBeNull();
  });

  it('links existing external types as uncertain and preserves stronger bundled evidence', () => {
    expect(withExternalTypes([], { name: '@types/react' }, '19.0.0')).toEqual([
      expect.objectContaining({
        name: 'TYPES',
        confidence: 'possible',
        packageName: '@types/react',
        href: 'https://npmx.dev/package/@types/react',
      }),
    ]);
    const bundled = packageSurfaceBadges({ types: './index.d.ts' });
    expect(withExternalTypes(bundled, { name: '@types/react' }, '19.0.0')).toEqual(bundled);
    expect(withExternalTypes([], null, '19.0.0')).toEqual([]);
  });

  it('warns about deprecated external types without claiming the compared version does not need them', () => {
    const result = withExternalTypes(
      [],
      {
        name: '@types/example',
        latestRelease: { version: '2.0.0', deprecated: 'The package provides its own declarations.' },
      },
      '1.5.0',
    );

    expect(result).toEqual([
      expect.objectContaining({
        name: 'TYPES',
        confidence: 'possible',
        warning: 'deprecated-external-types',
        href: 'https://npmx.dev/package/@types/example',
      }),
    ]);
    expect(result[0]?.detail).toContain('@types/example@2.0.0');
    expect(result[0]?.detail).toContain('1.5.0');
    expect(result[0]?.detail).toContain('The package provides its own declarations.');
  });

  it('does not replace strong bundled types with a deprecated external package warning', () => {
    const bundled = packageSurfaceBadges({ types: './index.d.ts' });
    expect(
      withExternalTypes(
        bundled,
        {
          name: '@types/example',
          latestRelease: { version: '2.0.0', deprecated: 'Use bundled types.' },
        },
        '3.0.0',
      ),
    ).toEqual(bundled);
  });

  it('does not warn for an empty deprecation notice', () => {
    const result = withExternalTypes(
      [],
      {
        name: '@types/example',
        latestRelease: { version: '2.0.0', deprecated: '  ' },
      },
      '1.0.0',
    );

    expect(result[0]?.warning).toBeUndefined();
    expect(result[0]?.confidence).toBe('possible');
  });
});
