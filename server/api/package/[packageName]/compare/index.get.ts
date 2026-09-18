import { Data, Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';
import npmFetch from 'npm-registry-fetch';

import { isExactSemver } from '#shared/compareSemver';
import {
  PackageNameSchema,
  RegistryVersionManifestSchema,
  toPackageVersion,
  type RegistryVersionManifest,
} from '#shared/package.defs';

import { getPackageBundleSize } from '../../../../utils/packageBundleSize';
import { getPackageReleaseNotes } from '../../../../utils/packageReleaseNotes';
import { getPackageTarballs } from '../../../../utils/packageTarball';
import { getPackageVulnerabilities } from '../../../../utils/packageVulnerabilities';

const VERSION_MAX_LENGTH = 256;

const VersionQueryParamSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));

const EndpointQueryParamsSchema = Schema.Struct({
  from: VersionQueryParamSchema,
  to: VersionQueryParamSchema,
});

const EndpointRouterParamsSchema = Schema.Struct({
  packageName: Schema.StringFromUriComponent.pipe(Schema.decodeTo(PackageNameSchema)),
});

const decodeRouterParams = Schema.decodeUnknownSync(EndpointRouterParamsSchema, { errors: 'all' });
const decodeQueryParams = Schema.decodeUnknownSync(EndpointQueryParamsSchema, { errors: 'all' });

const RegistryRequestError = Data.TaggedError('RegistryRequestError')<{
  readonly cause: unknown;
}>;

type RegistryRequestError = InstanceType<typeof RegistryRequestError>;

const registryRequestError = (cause: unknown): RegistryRequestError => new RegistryRequestError({ cause });

// The registry does not negotiate content on this route: `install-v1+json` and `application/json` return the
// same full manifest. Only the packument route abbreviates, so no `Accept` header is sent here.
const registryVersionManifestRequest = (packageName: string, version: string) =>
  Effect.tryPromise({
    try: () => npmFetch.json(`/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`),

    catch: registryRequestError,
  }).pipe(
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(RegistryVersionManifestSchema)(response, { errors: 'all' }),
    ),
  );

function getManifestEvidence(
  packageName: string,
  manifests: { from: RegistryVersionManifest; to: RegistryVersionManifest },
) {
  return Effect.all(
    {
      releaseNotes: getPackageReleaseNotes(packageName, manifests.from, manifests.to, process.env.GITHUB_TOKEN),
      tarballs: getPackageTarballs(manifests.from, manifests.to),
    },
    { concurrency: 2 },
  ).pipe(Effect.map((result) => ({ manifests, ...result })));
}

function getComparisonEvidence(packageName: string, from: string, to: string) {
  const versionManifests = Effect.all(
    {
      from: registryVersionManifestRequest(packageName, from),
      to: registryVersionManifestRequest(packageName, to),
    },
    { concurrency: 2 },
  );

  // GitHub and tarballs need manifest metadata; exact inputs let OSV and Bundlephobia start before npm resolves.
  return isExactSemver(from) && isExactSemver(to)
    ? Effect.all(
        {
          enriched: versionManifests.pipe(Effect.flatMap((manifests) => getManifestEvidence(packageName, manifests))),
          vulnerabilities: getPackageVulnerabilities(packageName, from, to),
          bundleSize: getPackageBundleSize(packageName, from, to),
        },
        { concurrency: 3 },
      ).pipe(Effect.map(({ enriched, vulnerabilities, bundleSize }) => ({ ...enriched, vulnerabilities, bundleSize })))
    : versionManifests.pipe(
        Effect.flatMap((manifests) =>
          Effect.all(
            {
              enriched: getManifestEvidence(packageName, manifests),
              vulnerabilities: getPackageVulnerabilities(packageName, manifests.from.version, manifests.to.version),
              bundleSize: getPackageBundleSize(packageName, manifests.from.version, manifests.to.version),
            },
            { concurrency: 3 },
          ).pipe(
            Effect.map(({ enriched, vulnerabilities, bundleSize }) => ({ ...enriched, vulnerabilities, bundleSize })),
          ),
        ),
      );
}

export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodeRouterParams);
  const { from, to } = await getValidatedQuery(event, decodeQueryParams);
  return Effect.runPromise(
    getComparisonEvidence(packageName, from, to).pipe(
      Effect.map(({ manifests, vulnerabilities, releaseNotes, bundleSize, tarballs }) => ({
        packageName,
        releaseNotes,
        from: {
          ...toPackageVersion(manifests.from),
          vulnerabilities: vulnerabilities.from,
          bundleSize: bundleSize.from,
          tarball: tarballs.from,
        },
        to: {
          ...toPackageVersion(manifests.to),
          vulnerabilities: vulnerabilities.to,
          bundleSize: bundleSize.to,
          tarball: tarballs.to,
        },
      })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
});
