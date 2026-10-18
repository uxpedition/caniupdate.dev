import { QueryClient } from '@tanstack/vue-query';
import type { NitroFetchRequest } from 'nitropack/types';
import { describe, expect, it } from 'vitest';
import { toValue } from 'vue';

import { prefetchDeclarations } from './comparisonDeclarationsPrefetch';
import { packageComparisonQueryOptions } from './packageComparisonQueryOptions';

describe('declaration SSR status and recovery', () => {
  it.each([400, 404, 429, 503, undefined])('preserves the failure boundary for status %s', async (statusCode) => {
    const client = new QueryClient();

    const requestFetch = <T, R extends NitroFetchRequest>(_url: R): Promise<T> =>
      Promise.reject(Object.assign(new Error('private-provider-marker'), { statusCode }));

    const options = packageComparisonQueryOptions(requestFetch, 'minimist', '1.0.0', '2.0.0');

    const failureStatus = await prefetchDeclarations(client, options);

    expect(failureStatus).toBe(statusCode === 400 || statusCode === 404 || statusCode === 429 ? statusCode : 503);
    expect(client.getQueryState(toValue(options.queryKey))).toBeUndefined();
    client.clear();
  });

  it('keeps a successful declaration response at 200 and available for hydration', async () => {
    const client = new QueryClient();

    const requestFetch = <T, R extends NitroFetchRequest>(_url: R): Promise<T> =>
      Promise.reject(new Error('not called'));

    const options = packageComparisonQueryOptions(requestFetch, 'minimist', '1.0.0', '2.0.0');
    const declarations = { packageName: 'minimist', from: { version: '1.0.0' }, to: { version: '2.0.0' } };
    client.setQueryData(toValue(options.queryKey), declarations);

    const failureStatus = await prefetchDeclarations(client, options);

    expect(failureStatus).toBeUndefined();
    expect(client.getQueryData(toValue(options.queryKey))).toEqual(declarations);
    client.clear();
  });
});
