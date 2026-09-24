import { Effect, Result } from 'effect';

import type { PackageBundleSize } from '../../shared/bundlephobia.defs';
import { bundlephobiaSizeUrl, getBundlephobiaSize } from './bundlephobia';

export const getVersionBundleSize = Effect.fn('Bundlephobia.getVersionBundleSize')(function* (
  packageName: string,
  version: string,
) {
  const source = { provider: 'bundlephobia' as const, url: bundlephobiaSizeUrl(packageName, version) };
  const result = yield* getBundlephobiaSize(packageName, version).pipe(Effect.result);
  if (Result.isFailure(result) || result.success.name !== packageName || result.success.version !== version) {
    return { ...source, status: 'unavailable', size: null, gzip: null } satisfies PackageBundleSize;
  }
  return {
    ...source,
    ...result.success,
    status: 'available',
    retrievedAt: new Date().toISOString(),
  } satisfies PackageBundleSize;
});

/** Bundle evidence for both versions, fetched concurrently; failures resolve to `unavailable` evidence. */
export const getPackageBundleSize = (packageName: string, fromVersion: string, toVersion: string) =>
  Effect.all(
    {
      from: getVersionBundleSize(packageName, fromVersion),
      to: getVersionBundleSize(packageName, toVersion),
    },
    { concurrency: 2 },
  );
