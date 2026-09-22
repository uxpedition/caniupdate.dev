// Shared server contract for the package comparison API. Both the factual comparison route and the AI briefing
// route resolve the same package/version pair, so they validate requests identically and collect evidence from the
// same provider scheduling and caches instead of trusting anything the browser supplies.

import { Cache, Data, Effect, Exit, Schema } from 'effect';
import type { HttpClient } from 'effect/unstable/http';
import npmFetch from 'npm-registry-fetch';

import type { BriefingInput } from '#shared/briefing.defs';
import { isExactSemver } from '#shared/compareSemver';
import type {
  ComparisonVersion,
  MeasuredPackageVersion,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
  TarballSummary,
} from '#shared/comparison.defs';
import { PackageNameSchema, RegistryVersionManifestSchema, toPackageVersion } from '#shared/package.defs';

import type { PackageTarball } from '../../shared/tarball.defs';
import { getPackageBundleSize } from './packageBundleSize';
import { compareDeclarations, compareMeasurements } from './packageComparison';
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

// Per-version lookup, shared within a request and reused across requests by `manifestCache`. Kept separate from the
// pair so each tarball can start as soon as its own manifest resolves.
const getManifest = (packageName: string, version: string) =>
  Effect.cached(Cache.get(manifestCache, new ManifestKey({ packageName, version })));

const getResolvedManifests = (packageName: string, from: string, to: string) =>
  Effect.gen(function* () {
    const fromManifest = yield* getManifest(packageName, from);
    const toManifest = yield* getManifest(packageName, to);
    const manifests = yield* Effect.cached(Effect.all({ from: fromManifest, to: toManifest }, { concurrency: 2 }));
    return yield* manifests;
  });

/** Manifest-only comparison; the payload the first paint depends on. */
export function getComparisonDeclarations(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<PackageDeclarationsResponse, RegistryRequestError, HttpClient.HttpClient> {
  return getResolvedManifests(packageName, from, to).pipe(
    Effect.map((manifests) => {
      const fromVersion = toPackageVersion(manifests.from);
      const toVersion = toPackageVersion(manifests.to);
      return {
        packageName,
        from: fromVersion,
        to: toVersion,
        comparison: compareDeclarations(fromVersion, toVersion),
      };
    }),
  );
}

const collectMeasurements = (packageName: string, from: string, to: string) =>
  Effect.gen(function* () {
    const fromManifest = yield* getManifest(packageName, from);
    const toManifest = yield* getManifest(packageName, to);
    const manifests = yield* Effect.cached(Effect.all({ from: fromManifest, to: toManifest }, { concurrency: 2 }));
    // Exact inputs can start measurement work before either manifest resolves; tags and ranges wait for resolution.
    const exact = isExactSemver(from) && isExactSemver(to);
    const evidence = yield* Effect.all(
      {
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
      { concurrency: 3 },
    );
    const resolvedManifests = yield* manifests;
    const fromVersion = {
      ...toPackageVersion(resolvedManifests.from),
      vulnerabilities: evidence.vulnerabilities.from,
      bundleSize: evidence.bundleSize.from,
      tarball: evidence.tarballs.from,
    };
    const toVersion = {
      ...toPackageVersion(resolvedManifests.to),
      vulnerabilities: evidence.vulnerabilities.to,
      bundleSize: evidence.bundleSize.to,
      tarball: evidence.tarballs.to,
    };
    return { from: fromVersion, to: toVersion, comparison: compareMeasurements(fromVersion, toVersion) };
  });

const toTarballSummary = ({ status, reasons, url, files, changelogs }: PackageTarball): TarballSummary => ({
  status,
  reasons,
  url,
  fileCount: files.length,
  changelogCount: changelogs.length,
});

const toMeasuredVersion = ({ tarball, ...version }: ComparisonVersion): MeasuredPackageVersion => ({
  ...version,
  tarball: toTarballSummary(tarball),
});

/** Measurement evidence for a resolved pair; the per-file inventory stays server-side. */
export function getComparisonMeasurements(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<PackageMeasurementsResponse, RegistryRequestError, HttpClient.HttpClient> {
  return collectMeasurements(packageName, from, to).pipe(
    Effect.map(({ from: fromVersion, to: toVersion, comparison }) => ({
      packageName,
      from: toMeasuredVersion(fromVersion),
      to: toMeasuredVersion(toVersion),
      comparison,
    })),
  );
}

/** The complete comparison facts shape consumed only by the briefing pipeline. */
export type ComparisonFacts = BriefingInput;

/** Complete facts for the briefing evidence packet; not exposed as a route. */
export function getComparisonFacts(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<ComparisonFacts, RegistryRequestError, HttpClient.HttpClient> {
  return Effect.all(
    {
      declarations: getComparisonDeclarations(packageName, from, to),
      measurements: collectMeasurements(packageName, from, to),
      releaseNotes: getResolvedManifests(packageName, from, to).pipe(
        Effect.flatMap((pair) => getPackageReleaseNotes(packageName, pair.from, pair.to, process.env.GITHUB_TOKEN)),
      ),
    },
    { concurrency: 3 },
  ).pipe(
    Effect.map(({ declarations, measurements, releaseNotes }) => ({
      packageName,
      releaseNotes,
      from: measurements.from,
      to: measurements.to,
      comparison: { ...declarations.comparison, ...measurements.comparison },
    })),
  );
}
