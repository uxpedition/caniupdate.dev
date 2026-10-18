import { describe, expect, it } from 'vitest';

import { isComparisonRouteParams } from './comparisonRouteParams';

describe('comparison route identity', () => {
  it.each(['1.0.0', '...2.0.0', '1.0.0...', '1.0.0...2.0.0...3.0.0', ' ...2.0.0'])(
    'rejects malformed version pair %s',
    (versionPair) => {
      expect(isComparisonRouteParams({ packageName: 'vue', versionPair })).toBe(false);
    },
  );

  it('accepts scoped names and selectors without requiring exact releases', () => {
    expect(isComparisonRouteParams({ packageName: '@vue/shared', versionPair: '^3.0.0...latest' })).toBe(true);
  });

  it('rejects invalid package names and non-string route parameters', () => {
    expect(isComparisonRouteParams({ packageName: 'not/a/package', versionPair: '1.0.0...2.0.0' })).toBe(false);
    expect(isComparisonRouteParams({ packageName: ['vue'], versionPair: '1.0.0...2.0.0' })).toBe(false);
  });
});
