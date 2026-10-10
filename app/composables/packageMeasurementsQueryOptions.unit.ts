import type { NitroFetchRequest } from 'nitropack/types';
import { describe, expect, it } from 'vitest';
import { ref, toValue } from 'vue';

import { packageMeasurementsQueryOptions } from './packageMeasurementsQueryOptions';

const requestFetch = <T, R extends NitroFetchRequest>(_url: R): Promise<T> => Promise.reject(new Error('not called'));

describe('packageMeasurementsQueryOptions', () => {
  it('uses a separate key for normalized measurement route values', () => {
    const options = packageMeasurementsQueryOptions(requestFetch, ref(' react '), ref(' 19.0.0 '), ref(' 19.3.0 '));

    expect(toValue(options.queryKey)).toEqual(['npm', 'packages', 'measurements', 'react', '19.0.0', '19.3.0']);
  });

  it('stays disabled outside the browser', () => {
    const options = packageMeasurementsQueryOptions(requestFetch, ref('react'), ref('19.0.0'), ref('19.3.0'));

    expect(toValue(options.enabled)).toBe(false);
  });
});
