// Shared server contract for the package comparison API. Both routes validate requests and resolve the same
// package/version manifests; complete evidence (tarball inventory, advisories, bundle sizes, and release notes) is
// collected only for the AI briefing pipeline.

import { createHash } from 'node:crypto';

import { Effect, Schema } from 'effect';
import { HttpClient } from 'effect/http';

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
import { PackageTarballSchema, type PackageTarball } from '../../shared/comparison/evidence/tarball.defs';
import { isExactSemver } from '../../shared/comparison/package/compareSemver';
import {
  RegistryVersionManifestSchema,
  toPackageVersion,
  type RegistryVersionManifest,
} from '../../shared/comparison/package/package.defs';
import { RegistryRequestError } from '../httpDependencies/npm/errors';
import { getRegistryJson } from '../httpDependencies/npm/registry';
import { getPackageTarball } from '../httpDependencies/npm/tarball';
import { compareDeclarations } from './declarations/compare';
import {
  EvidenceCollectionError,
  toEvidenceCacheFailure,
  toPackageEvidenceFailure,
  type PackageEvidenceFailure,
} from './evidence/errors';
import { getPackageReleaseNotes } from './evidence/releaseNotes';
import type { ComparisonEvidenceCacheOptions, ComparisonEvidenceServices } from './evidence/services';
import { getVersionBundleSize } from './measurements/bundleSize';
import { compareMeasurements } from './measurements/compare';
import { getPackageVulnerabilities } from './measurements/vulnerabilities';

export const EVIDENCE_CACHE_MAX_AGE_MS = 300_000;

export const EVIDENCE_COLLECTOR_REVISION = 'comparison-evidence-v1';

export const ARCHIVE_INSPECTOR_REVISION = 'archive-inspector-v2';

// Each identity is a closed object built at one call site below; the github key serializes whole manifests so every
// field the release-note lookup depends on contributes to the digest.
type CacheIdentity =
  | { readonly revision: string; readonly packageName: string; readonly version: string }
  | {
      readonly revision: string;
      readonly packageName: string;
      readonly fromVersion: string;
      readonly toVersion: string;
    }
  | { readonly revision: string; readonly integrity: { readonly algorithm: string; readonly value: string } }
  | {
      readonly revision: string;
      readonly packageName: string;
      readonly from: RegistryVersionManifest;
      readonly to: RegistryVersionManifest;
    };

const cacheKey = (scope: string, input: CacheIdentity): string => {
  const serialized = JSON.stringify(input);
  const digest = createHash('sha256').update(serialized).digest('hex');

  return `${scope}:${digest}`;
};

const runCached = <T>(
  key: string,
  effect: Effect.Effect<T, unknown, HttpClient.HttpClient>,
  services: ComparisonEvidenceServices | undefined,
  options: ComparisonEvidenceCacheOptions<T>,
): Effect.Effect<T, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const cache = services?.cache;

  if (cache === undefined) {
    return effect.pipe(
      Effect.mapError(toPackageEvidenceFailure),
      Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
    );
  }

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    return yield* Effect.tryPromise({
      try: () =>
        cache.load(
          key,
          () =>
            Effect.runPromise(
              effect.pipe(
                Effect.provideService(HttpClient.HttpClient, client),
                Effect.mapError(toPackageEvidenceFailure),
                Effect.catchDefect((cause) => Effect.fail(new EvidenceCollectionError({ cause }))),
              ),
            ),
          options,
        ),
      catch: toEvidenceCacheFailure,
    });
  });
};

const safeTarballUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    return (
      parsed.origin === 'https://registry.npmjs.org' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
};

const archiveIntegrityPolicy = (manifest: RegistryVersionManifest) =>
  manifest.dist.integrity === undefined
    ? { algorithm: 'sha1', value: manifest.dist.shasum }
    : { algorithm: 'sri', value: manifest.dist.integrity };

const withArchiveAdmission = (
  manifest: RegistryVersionManifest,
  services: ComparisonEvidenceServices | undefined,
): Effect.Effect<PackageTarball, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const inspect = getPackageTarball(manifest).pipe(Effect.mapError(toPackageEvidenceFailure));
  const admission = services?.archiveAdmission;

  return admission === undefined ? inspect : admission.withPermit(inspect);
};

// The registry does not negotiate content on this route: `install-v1+json` and `application/json` return the
// same full manifest. Only the packument route abbreviates, so no `Accept` header is sent here.
const registryVersionManifestRequest = (packageName: string, version: string) =>
  Effect.gen(function* () {
    const response = yield* getRegistryJson(`/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`);

    return yield* Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' });
  }).pipe(Effect.mapError((cause) => new RegistryRequestError({ cause })));

// Each comparison side shares its request-local manifest effect across branches. Keep the sides separate
// so each tarball can start as soon as its own manifest resolves.
const getManifest = (packageName: string, version: string, services?: ComparisonEvidenceServices) => {
  const request = registryVersionManifestRequest(packageName, version);

  const cached = runCached(
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

const cachedTarball = (
  manifest: RegistryVersionManifest,
  services?: ComparisonEvidenceServices,
): Effect.Effect<PackageTarball, PackageEvidenceFailure, HttpClient.HttpClient> => {
  const validUrl = safeTarballUrl(manifest.dist.tarball);

  const inspect = (validUrl ? withArchiveAdmission(manifest, services) : getPackageTarball(manifest)).pipe(
    Effect.mapError(toPackageEvidenceFailure),
  );

  if (services?.cache === undefined || !validUrl) return inspect;

  const result = runCached(
    cacheKey('archive', {
      revision: ARCHIVE_INSPECTOR_REVISION,
      integrity: archiveIntegrityPolicy(manifest),
    }),
    inspect,
    services,
    { ttlMs: null, cacheable: (value) => value.status !== 'unavailable', isValid: Schema.is(PackageTarballSchema) },
  );

  return result.pipe(Effect.map((value) => ({ ...value, url: manifest.dist.tarball })));
};

const cachedVulnerabilities = (
  packageName: string,
  fromVersion: string,
  toVersion: string,
  services?: ComparisonEvidenceServices,
) =>
  runCached(
    cacheKey('osv', { revision: EVIDENCE_COLLECTOR_REVISION, packageName, fromVersion, toVersion }),
    getPackageVulnerabilities(packageName, fromVersion, toVersion),
    services,
    {
      ttlMs: EVIDENCE_CACHE_MAX_AGE_MS,
      cacheable: (value) => value.from.status === 'available' && value.to.status === 'available',
      isValid: Schema.is(Schema.Struct({ from: PackageVulnerabilitiesSchema, to: PackageVulnerabilitiesSchema })),
    },
  );

const cachedBundleVersion = (packageName: string, version: string, services?: ComparisonEvidenceServices) =>
  runCached(
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
  );

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
      ),
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
