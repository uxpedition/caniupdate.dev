import type { NitroFetchRequest } from 'nitropack/types';
import { describe, expect, it } from 'vitest';
import { ref, toValue } from 'vue';

import { packageBriefingQueryOptions } from './packageBriefingQueryOptions';

const requestFetch = <T, R extends NitroFetchRequest>(_url: R, _options?: unknown): Promise<T> =>
  Promise.reject(new Error('not called'));

describe('packageBriefingQueryOptions', () => {
  it('uses a separate key for the briefing endpoint with normalized versions', () => {
    const options = packageBriefingQueryOptions(requestFetch, ref(' react '), ref(' 19.0.0 '), ref(' 19.3.0 '));

    expect(toValue(options.queryKey)).toEqual(['npm', 'packages', 'briefing', 'react', '19.0.0', '19.3.0']);
    expect(toValue(options.enabled)).toBe(false);
  });
});
