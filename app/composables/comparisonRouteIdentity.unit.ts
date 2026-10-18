import { describe, expect, it } from 'vitest';

import { comparisonRedirect, substantiveSearch } from './comparisonRouteIdentity';

describe('resolved comparison identity', () => {
  it('uses a temporary redirect for a moving selector', () => {
    expect(comparisonRedirect('/minimist/latest...^1.2', 'minimist', 'latest', '^1.2', '1.2.8', '1.2.8')).toEqual({
      path: '/minimist/1.2.8...1.2.8',
      redirectCode: 302,
    });
  });

  it('keeps ordered releases, scoped encoding and prerelease identifiers', () => {
    expect(
      comparisonRedirect('/@vue%2fcore/3.0.0...next', '@vue/core', '3.0.0', 'next', '3.0.0', '4.0.0-beta.2'),
    ).toEqual({
      path: '/@vue%2Fcore/3.0.0...4.0.0-beta.2',
      redirectCode: 302,
    });
    expect(comparisonRedirect('/minimist/latest...1.0.0', 'minimist', 'latest', '1.0.0', '1.2.8', '1.0.0')?.path).toBe(
      '/minimist/1.2.8...1.0.0',
    );
  });

  it('permanently normalizes only formatting of already exact identities', () => {
    expect(
      comparisonRedirect(
        '/@vue%2fcore/3.0.0...4.0.0-beta.2',
        '@vue/core',
        '3.0.0',
        '4.0.0-beta.2',
        '3.0.0',
        '4.0.0-beta.2',
      ),
    ).toEqual({
      path: '/@vue%2Fcore/3.0.0...4.0.0-beta.2',
      redirectCode: 301,
    });
    expect(
      comparisonRedirect('/minimist/1.0.0...1.2.8', 'minimist', '1.0.0', '1.2.8', '1.0.0', '1.2.8'),
    ).toBeUndefined();
    expect(
      comparisonRedirect(
        '/@vue%2Fcore/3.0.0...4.0.0-beta.2',
        '@vue/core',
        '3.0.0',
        '4.0.0-beta.2',
        '3.0.0',
        '4.0.0-beta.2',
      ),
    ).toBeUndefined();
  });
});

describe('canonical query identity', () => {
  it('removes tracking parameters but preserves substantive and repeated values', () => {
    expect(substantiveSearch('?utm_source=mail&tab=notes&gclid=123&tab=facts&filter=a%2Bb#details')).toBe(
      '?tab=notes&tab=facts&filter=a%2Bb',
    );
  });

  it('does not discard unknown parameters or tracking-like substantive names', () => {
    expect(substantiveSearch('?source=registry&utm_custom=keep&ref=release')).toBe(
      '?source=registry&utm_custom=keep&ref=release',
    );
    expect(substantiveSearch('?utm_campaign=launch&fbclid=123')).toBe('');
  });
});
