import { describe, expect, it } from 'vitest';

import { createSemverAtLeastPredicate, sortSemverDescendingInPlace } from './compareSemver';

describe('sortSemverDescendingInPlace', () => {
  it('orders stable and prerelease versions by semver precedence', () => {
    const versions = ['1.9.0', '2.0.0-rc.2', '2.0.0', '1.10.0', '2.0.0-rc.10', '2.0.0-rc.1'];

    sortSemverDescendingInPlace(versions);

    expect(versions).toEqual(['2.0.0', '2.0.0-rc.10', '2.0.0-rc.2', '2.0.0-rc.1', '1.10.0', '1.9.0']);
  });

  it('retains input order when versions differ only by build metadata', () => {
    const versions = ['1.0.0+first', '1.0.0+second'];

    sortSemverDescendingInPlace(versions);

    expect(versions).toEqual(['1.0.0+first', '1.0.0+second']);
  });

  it('retains numeric locale ordering when version strings are not semver', () => {
    const versions = ['pkg-2', 'pkg-10', 'pkg-1'];

    sortSemverDescendingInPlace(versions);

    expect(versions).toEqual(['pkg-10', 'pkg-2', 'pkg-1']);
  });
});

describe('createSemverAtLeastPredicate', () => {
  it('uses semver precedence against a fixed lower bound', () => {
    const isAtLeast = createSemverAtLeastPredicate('2.0.0');

    expect(isAtLeast('2.0.0')).toBe(true);
    expect(isAtLeast('2.0.1')).toBe(true);
    expect(isAtLeast('2.0.0-rc.10')).toBe(false);
  });

  it('retains numeric locale comparison when the lower bound is not semver', () => {
    const isAtLeast = createSemverAtLeastPredicate('pkg-2');

    expect(isAtLeast('pkg-10')).toBe(true);
    expect(isAtLeast('pkg-1')).toBe(false);
  });
});
