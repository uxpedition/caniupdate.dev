import { Cache, Data, Effect, Exit, Result } from 'effect';

import type { PackageBundleSize } from '../../shared/bundlephobia.defs';
import { bundlephobiaSizeUrl, getBundlephobiaSize } from './bundlephobia';

const getVersionBundleSize = Effect.fn('Bundlephobia.getVersionBundleSize')(function* (
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

class BundleSizeKey extends Data.Class<{ packageName: string; version: string }> {}

const bundleSizeCache = Effect.runSync(
  Cache.makeWith(({ packageName, version }: BundleSizeKey) => getVersionBundleSize(packageName, version), {
    capacity: 128,
    requireServicesAt: 'lookup',
    timeToLive: (exit) => (Exit.isSuccess(exit) && exit.value.status === 'available' ? '1 hour' : 0),
  }),
);

/** Cache the evidence with its original retrievedAt; failed builds can recover on the next request. */
export const getPackageBundleSize = (packageName: string, fromVersion: string, toVersion: string) =>
  Effect.all(
    {
      from: Cache.get(bundleSizeCache, new BundleSizeKey({ packageName, version: fromVersion })),
      to: Cache.get(bundleSizeCache, new BundleSizeKey({ packageName, version: toVersion })),
    },
    { concurrency: 2 },
  );
