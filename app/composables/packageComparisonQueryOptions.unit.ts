import type { NitroFetchRequest } from 'nitropack/types';
import { describe, expect, it } from 'vitest';
import { ref, toValue } from 'vue';

import { packageComparisonQueryOptions } from './packageComparisonQueryOptions';

const requestFetch = <T, R extends NitroFetchRequest>(_url: R): Promise<T> => Promise.reject(new Error('not called'));

describe('packageComparisonQueryOptions', () => {
  it('normalizes route values into an enabled comparison query key', () => {
    const options = packageComparisonQueryOptions(requestFetch, ref(' react '), ref(' 19.0.0 '), ref(' 19.3.0 '));

    expect(toValue(options.queryKey)).toEqual(['npm', 'packages', 'comparison', 'react', '19.0.0', '19.3.0']);
    expect(toValue(options.enabled)).toBe(true);
  });

  it('remains disabled until all comparison route values are present', () => {
    const options = packageComparisonQueryOptions(requestFetch, ref('react'), ref(''), ref('19.3.0'));

    expect(toValue(options.enabled)).toBe(false);
  });
});
