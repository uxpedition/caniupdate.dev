// Shared server contract for the package comparison API. Both routes validate requests and resolve the same
// package/version manifests; complete evidence (tarball inventory, advisories, bundle sizes, and release notes) is
// collected only for the AI briefing pipeline.

import { Data, Effect, Schema } from 'effect';
import type { HttpClient } from 'effect/unstable/http';

import type { BriefingInput } from '#shared/briefing.defs';
import { isExactSemver } from '#shared/compareSemver';
import type {
  ComparisonVersion,
  MeasuredPackageVersion,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
  TarballSummary,
} from '#shared/comparison.defs';
import {
  PackageNameSchema,
  RegistryVersionManifestSchema,
  toPackageVersion,
  type RegistryVersionManifest,
} from '#shared/package.defs';

import type { PackageTarball } from '../../shared/tarball.defs';
import { getRegistryJson } from './npmRegistry';
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
    const response = yield* getRegistryJson(`/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`);
    return yield* Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' });
  }).pipe(Effect.mapError(registryRequestError));

// Each comparison side shares its request-local manifest effect across branches. Keep the sides separate
// so each tarball can start as soon as its own manifest resolves.
const getManifest = (packageName: string, version: string) =>
  Effect.cached(registryVersionManifestRequest(packageName, version));

type ManifestLookups = {
  readonly from: Effect.Effect<RegistryVersionManifest, RegistryRequestError, HttpClient.HttpClient>;
  readonly to: Effect.Effect<RegistryVersionManifest, RegistryRequestError, HttpClient.HttpClient>;
};

const allocateManifestLookups = (packageName: string, from: string, to: string) =>
  Effect.gen(function* () {
    return {
      from: yield* getManifest(packageName, from),
      to: yield* getManifest(packageName, to),
    } satisfies ManifestLookups;
  });

const resolveManifestPair = ({ from, to }: ManifestLookups) => Effect.all({ from, to }, { concurrency: 2 });

const declarationsFrom = (packageName: string, lookups: ManifestLookups) =>
  Effect.gen(function* () {
    const manifests = yield* resolveManifestPair(lookups);
    const fromVersion = toPackageVersion(manifests.from);
    const toVersion = toPackageVersion(manifests.to);
    return {
      packageName,
      from: fromVersion,
      to: toVersion,
      comparison: compareDeclarations(fromVersion, toVersion),
    };
  });

/** Manifest-only comparison; the payload the first paint depends on. */
export function getComparisonDeclarations(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<PackageDeclarationsResponse, RegistryRequestError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to);
    return yield* declarationsFrom(packageName, lookups);
  });
}

const collectMeasurements = (packageName: string, from: string, to: string, lookups: ManifestLookups) =>
  Effect.gen(function* () {
    const manifests = resolveManifestPair(lookups);
    // Exact inputs can start measurement work before either manifest resolves; tags and ranges wait for resolution.
    const exact = isExactSemver(from) && isExactSemver(to);
    const evidence = yield* Effect.all(
      {
        tarballs: Effect.all(
          {
            from: lookups.from.pipe(Effect.flatMap(getPackageTarball)),
            to: lookups.to.pipe(Effect.flatMap(getPackageTarball)),
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
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to);
    const { from: fromVersion, to: toVersion, comparison } = yield* collectMeasurements(packageName, from, to, lookups);
    return {
      packageName,
      from: toMeasuredVersion(fromVersion),
      to: toMeasuredVersion(toVersion),
      comparison,
    };
  });
}

/** The complete comparison facts shape consumed only by the briefing pipeline. */
export type ComparisonFacts = BriefingInput;

/** Complete facts for the briefing evidence packet; not exposed as a route. */
export function getComparisonFacts(
  packageName: string,
  from: string,
  to: string,
): Effect.Effect<ComparisonFacts, RegistryRequestError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to);
    const { declarations, measurements, releaseNotes } = yield* Effect.all(
      {
        declarations: declarationsFrom(packageName, lookups),
        measurements: collectMeasurements(packageName, from, to, lookups),
        releaseNotes: resolveManifestPair(lookups).pipe(
          Effect.flatMap((pair) => getPackageReleaseNotes(packageName, pair.from, pair.to, process.env.GITHUB_TOKEN)),
        ),
      },
      { concurrency: 3 },
    );
    return {
      packageName,
      releaseNotes,
      from: measurements.from,
      to: measurements.to,
      comparison: { ...declarations.comparison, ...measurements.comparison },
    };
  });
}
