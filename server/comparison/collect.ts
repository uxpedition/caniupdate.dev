// Shared server contract for the package comparison API. Both routes validate requests and resolve the same
// package/version manifests; complete evidence (tarball inventory, advisories, bundle sizes, and release notes) is
// collected only for the AI briefing pipeline.

import { Effect, Schema } from 'effect';
import { HttpClient } from 'effect/http';
import { maxSatisfying, validRange } from 'semver';

import type { BriefingInput } from '../../shared/comparison/briefing/briefing.defs';
import type {
  ComparisonVersion,
  MeasuredPackageVersion,
  PackageDeclarationsResponse,
  PackageMeasurementsResponse,
  TarballSummary,
} from '../../shared/comparison/comparison.defs';
import { PackageBundleSizeSchema } from '../../shared/comparison/evidence/bundlephobia.defs';
import { PackageReleaseNotesSchema } from '../../shared/comparison/evidence/github.defs';
import { PackageVulnerabilitiesSchema } from '../../shared/comparison/evidence/osv.defs';
import type { PackageTarball } from '../../shared/comparison/evidence/tarball.defs';
import { isExactSemver } from '../../shared/comparison/package/compareSemver';
import {
  RegistryPackageMetadataSchema,
  RegistryVersionManifestSchema,
  toPackageVersion,
  type RegistryVersionManifest,
} from '../../shared/comparison/package/package.defs';
import type { TelemetryProviderSchema } from '../../shared/telemetry/telemetryFields';
import { RegistryRequestError } from '../httpDependencies/npm/errors';
import { getRegistryJson } from '../httpDependencies/npm/registry';
import { compareDeclarations } from './declarations/compare';
import { cacheKey, runCached } from './evidence/cacheLookup';
import type { PackageEvidenceFailure } from './evidence/errors';
import { getPackageReleaseNotes } from './evidence/releaseNotes';
import type { ComparisonEvidenceServices } from './evidence/services';
import { cachedTarball } from './evidence/tarball';
import { getVersionBundleSize } from './measurements/bundleSize';
import { compareMeasurements } from './measurements/compare';
import { getPackageVulnerabilities } from './measurements/vulnerabilities';

export const EVIDENCE_CACHE_MAX_AGE_MS = 300_000;

export const EVIDENCE_COLLECTOR_REVISION = 'comparison-evidence-v1';

type EvidenceProvider = typeof TelemetryProviderSchema.Type;

type ProviderStatus = 'available' | 'partial' | 'unavailable';

// One summary per provider lookup: `unavailable` only when every side is unavailable, `partial` for any other
// degradation, and nothing when every side is available. Request-wide failures stay on the error path.
const reportProviderAvailability = (provider: EvidenceProvider, ...statuses: ReadonlyArray<ProviderStatus>) => {
  if (statuses.every((status) => status === 'available')) return Effect.void;

  const outcome = statuses.every((status) => status === 'unavailable') ? 'unavailable' : 'partial';

  return Effect.logInfo('evidence.collection.completed').pipe(
    Effect.annotateLogs({ operation: 'collection', provider, outcome }),
  );
};

// Ranges need the version index; npm's version endpoint resolves only exact releases and tags.
// Fetch the selected full manifest separately: abbreviated metadata omits declarations we compare.
const registryVersionManifestRequest = Effect.fnUntraced(
  function* (packageName: string, selector: string) {
    let version = selector;

    if (!isExactSemver(selector) && validRange(selector) !== null) {
      const response = yield* getRegistryJson(`/${encodeURIComponent(packageName)}`, {
        accept: 'application/vnd.npm.install-v1+json',
      });

      const metadata = yield* Schema.decodeUnknownEffect(RegistryPackageMetadataSchema)(response);
      const selected = maxSatisfying(Object.keys(metadata.versions), selector);

      if (selected === null) return yield* Effect.fail(new Error('No matching published release'));

      version = selected;
    }

    const response = yield* getRegistryJson(`/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`);

    return yield* Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' });
  },
  Effect.mapError((cause) => new RegistryRequestError({ cause })),
);

// Each comparison side shares its request-local manifest effect across branches. Keep the sides separate
// so each tarball can start as soon as its own manifest resolves.
const getManifest = (packageName: string, version: string, services?: ComparisonEvidenceServices) => {
  const request = registryVersionManifestRequest(packageName, version);

  const cached = runCached(
    'registry',
    cacheKey('manifest', { revision: EVIDENCE_COLLECTOR_REVISION, packageName, version }),
    request,
    services,
    { ttlMs: EVIDENCE_CACHE_MAX_AGE_MS, cacheable: () => true, isValid: Schema.is(RegistryVersionManifestSchema) },
  );

  return Effect.cached(cached);
};

type ManifestLookups = {
  readonly from: Effect.Effect<RegistryVersionManifest, PackageEvidenceFailure, HttpClient.HttpClient>;
  readonly to: Effect.Effect<RegistryVersionManifest, PackageEvidenceFailure, HttpClient.HttpClient>;
};

const allocateManifestLookups = (
  packageName: string,
  from: string,
  to: string,
  services?: ComparisonEvidenceServices,
) =>
  Effect.gen(function* () {
    return {
      from: yield* getManifest(packageName, from, services),
      to: yield* getManifest(packageName, to, services),
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
  services?: ComparisonEvidenceServices,
): Effect.Effect<PackageDeclarationsResponse, PackageEvidenceFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to, services);

    return yield* declarationsFrom(packageName, lookups);
  });
}

const cachedVulnerabilities = (
  packageName: string,
  fromVersion: string,
  toVersion: string,
  services?: ComparisonEvidenceServices,
) =>
  runCached(
    'osv',
    cacheKey('osv', { revision: EVIDENCE_COLLECTOR_REVISION, packageName, fromVersion, toVersion }),
    getPackageVulnerabilities(packageName, fromVersion, toVersion),
    services,
    {
      ttlMs: EVIDENCE_CACHE_MAX_AGE_MS,
      cacheable: (value) => value.from.status === 'available' && value.to.status === 'available',
      isValid: Schema.is(Schema.Struct({ from: PackageVulnerabilitiesSchema, to: PackageVulnerabilitiesSchema })),
    },
  ).pipe(Effect.tap((value) => reportProviderAvailability('osv', value.from.status, value.to.status)));

const cachedBundleVersion = (packageName: string, version: string, services?: ComparisonEvidenceServices) =>
  runCached(
    'bundle',
    cacheKey('bundle', { revision: EVIDENCE_COLLECTOR_REVISION, packageName, version }),
    getVersionBundleSize(packageName, version),
    services,
    {
      ttlMs: EVIDENCE_CACHE_MAX_AGE_MS,
      cacheable: (value) => value.status === 'available',
      isValid: Schema.is(PackageBundleSizeSchema),
    },
  );

const cachedReleaseNotes = (
  packageName: string,
  from: RegistryVersionManifest,
  to: RegistryVersionManifest,
  services?: ComparisonEvidenceServices,
) =>
  runCached(
    'release-notes',
    cacheKey('github', { revision: EVIDENCE_COLLECTOR_REVISION, packageName, from, to }),
    getPackageReleaseNotes(
      packageName,
      from,
      to,
      services?.githubToken ?? (typeof process === 'undefined' ? undefined : process.env.GITHUB_TOKEN),
    ),
    services,
    {
      ttlMs: EVIDENCE_CACHE_MAX_AGE_MS,
      cacheable: (value) => value.status === 'available',
      isValid: Schema.is(PackageReleaseNotesSchema),
    },
  ).pipe(Effect.tap((value) => reportProviderAvailability('release-notes', value.status)));

const collectMeasurementEvidence = (
  packageName: string,
  from: string,
  to: string,
  lookups: ManifestLookups,
  services?: ComparisonEvidenceServices,
) => {
  // Exact inputs start providers immediately; tags and ranges wait for registry resolution.
  const versions =
    isExactSemver(from) && isExactSemver(to)
      ? Effect.succeed({ from, to })
      : resolveManifestPair(lookups).pipe(Effect.map((pair) => ({ from: pair.from.version, to: pair.to.version })));

  return Effect.all(
    {
      tarballs: Effect.all(
        {
          from: lookups.from.pipe(Effect.flatMap((manifest) => cachedTarball(manifest, services))),
          to: lookups.to.pipe(Effect.flatMap((manifest) => cachedTarball(manifest, services))),
        },
        { concurrency: 2 },
      ).pipe(Effect.tap((sides) => reportProviderAvailability('tarball', sides.from.status, sides.to.status))),
      vulnerabilities: versions.pipe(
        Effect.flatMap((pair) => cachedVulnerabilities(packageName, pair.from, pair.to, services)),
      ),
      bundleSize: versions.pipe(
        Effect.flatMap((pair) =>
          Effect.all(
            {
              from: cachedBundleVersion(packageName, pair.from, services),
              to: cachedBundleVersion(packageName, pair.to, services),
            },
            { concurrency: 2 },
          ),
        ),
        Effect.tap((sides) => reportProviderAvailability('bundle', sides.from.status, sides.to.status)),
      ),
    },
    { concurrency: 3 },
  );
};

const collectMeasurements = (
  packageName: string,
  from: string,
  to: string,
  lookups: ManifestLookups,
  services?: ComparisonEvidenceServices,
) =>
  Effect.gen(function* () {
    const evidence = yield* collectMeasurementEvidence(packageName, from, to, lookups, services);
    const resolvedManifests = yield* resolveManifestPair(lookups);

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
  services?: ComparisonEvidenceServices,
): Effect.Effect<PackageMeasurementsResponse, PackageEvidenceFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to, services);

    const {
      from: fromVersion,
      to: toVersion,
      comparison,
    } = yield* collectMeasurements(packageName, from, to, lookups, services);

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
  services?: ComparisonEvidenceServices,
): Effect.Effect<ComparisonFacts, PackageEvidenceFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const lookups = yield* allocateManifestLookups(packageName, from, to, services);

    const { declarations, measurements, releaseNotes } = yield* Effect.all(
      {
        declarations: declarationsFrom(packageName, lookups),
        measurements: collectMeasurements(packageName, from, to, lookups, services),
        releaseNotes: resolveManifestPair(lookups).pipe(
          Effect.flatMap((pair) => cachedReleaseNotes(packageName, pair.from, pair.to, services)),
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
