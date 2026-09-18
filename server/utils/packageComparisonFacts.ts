// Shared server contract for the package comparison API. Both the factual comparison route and the AI briefing
// route resolve the same package/version pair, so they validate requests identically and collect evidence from the
// same provider scheduling and caches instead of trusting anything the browser supplies.

import { Cache, Data, Effect, Exit, Schema } from 'effect';
import type { HttpClient } from 'effect/unstable/http';
import npmFetch from 'npm-registry-fetch';

import type { BriefingInput } from '#shared/briefing.defs';
import { isExactSemver } from '#shared/compareSemver';
import { PackageNameSchema, RegistryVersionManifestSchema, toPackageVersion } from '#shared/package.defs';

import { getPackageBundleSize } from './packageBundleSize';
import { comparePackages } from './packageComparison';
import { getPackageReleaseNotes } from './packageReleaseNotes';
import { getPackageTarball } from './packageTarball';
import { getPackageVulnerabilities } from './packageVulnerabilities';

const VERSION_MAX_LENGTH = 256;

const VersionQueryParamSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));

export const PackageComparisonQuerySchema = Schema.Struct({
  from: VersionQueryParamSchema,
  to: VersionQueryParamSchema,
});

export const PackageComparisonRouterParamsSchema = Schema.Struct({
  packageName: Schema.StringFromUriComponent.pipe(Schema.decodeTo(PackageNameSchema)),
});

export const decodePackageComparisonRouterParams = Schema.decodeUnknownSync(PackageComparisonRouterParamsSchema, {
  errors: 'all',
});
export const decodePackageComparisonQuery = Schema.decodeUnknownSync(PackageComparisonQuerySchema, { errors: 'all' });

const RegistryRequestError = Data.TaggedError('RegistryRequestError')<{
  readonly cause: unknown;
}>;

export type RegistryRequestError = InstanceType<typeof RegistryRequestError>;

const registryRequestError = (cause: unknown): RegistryRequestError => new RegistryRequestError({ cause });

// The registry does not negotiate content on this route: `install-v1+json` and `application/json` return the
// same full manifest. Only the packument route abbreviates, so no `Accept` header is sent here.
const registryVersionManifestRequest = (packageName: string, version: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => npmFetch.json(`/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`),

      catch: (cause) => cause,
    });
    return yield* Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' });
  }).pipe(Effect.mapError(registryRequestError));

class ManifestKey extends Data.Class<{ packageName: string; version: string }> {}

const manifestCache = Effect.runSync(
  Cache.makeWith(({ packageName, version }: ManifestKey) => registryVersionManifestRequest(packageName, version), {
    capacity: 128,
    // Tags/ranges must resolve afresh; only exact-version successes survive the current lookup.
    timeToLive: (exit, key) => (Exit.isSuccess(exit) && isExactSemver(key.version) ? '5 minutes' : 0),
  }),
);

function getComparisonEvidence(packageName: string, from: string, to: string) {
  return Effect.gen(function* () {
    // Request-scoped sharing is also needed for tags, whose process-cache lifetime is zero.
    const fromManifest = yield* Effect.cached(
      Cache.get(manifestCache, new ManifestKey({ packageName, version: from })),
    );
    const toManifest = yield* Effect.cached(Cache.get(manifestCache, new ManifestKey({ packageName, version: to })));
    const manifests = yield* Effect.cached(Effect.all({ from: fromManifest, to: toManifest }, { concurrency: 2 }));
    const exact = isExactSemver(from) && isExactSemver(to);
    return yield* Effect.all(
      {
        manifests,
        releaseNotes: manifests.pipe(
          Effect.flatMap((pair) => getPackageReleaseNotes(packageName, pair.from, pair.to, process.env.GITHUB_TOKEN)),
        ),
        tarballs: Effect.all(
          {
            from: fromManifest.pipe(Effect.flatMap(getPackageTarball)),
            to: toManifest.pipe(Effect.flatMap(getPackageTarball)),
          },
          { concurrency: 2 },
        ),
        vulnerabilities: exact
          ? getPackageVulnerabilities(packageName, from, to)
          : manifests.pipe(
              Effect.flatMap((pair) => getPackageVulnerabilities(packageName, pair.from.version, pair.to.version)),
            ),
        bundleSize: exact
          ? getPackageBundleSize(packageName, from, to)
          : manifests.pipe(
              Effect.flatMap((pair) => getPackageBundleSize(packageName, pair.from.version, pair.to.version)),
            ),
      },
      { concurrency: 5 },
    );
  });
}

/** The factual comparison for a resolved pair; the same object feeds the AI briefing. */
export type ComparisonFacts = BriefingInput;

export function getComparisonFacts(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<ComparisonFacts, RegistryRequestError, HttpClient.HttpClient> {
  return getComparisonEvidence(packageName, from, to).pipe(
    Effect.map(({ manifests, vulnerabilities, releaseNotes, bundleSize, tarballs }) => {
      const fromVersion = {
        ...toPackageVersion(manifests.from),
        vulnerabilities: vulnerabilities.from,
        bundleSize: bundleSize.from,
        tarball: tarballs.from,
      };
      const toVersion = {
        ...toPackageVersion(manifests.to),
        vulnerabilities: vulnerabilities.to,
        bundleSize: bundleSize.to,
        tarball: tarballs.to,
      };
      return {
        packageName,
        releaseNotes,
        from: fromVersion,
        to: toVersion,
        comparison: comparePackages(fromVersion, toVersion),
      };
    }),
  );
}
