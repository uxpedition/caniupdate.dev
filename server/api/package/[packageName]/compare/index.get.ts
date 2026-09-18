import { Data, Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';
import npmFetch from 'npm-registry-fetch';

import { isExactSemver } from '#shared/compareSemver';
import { PackageNameSchema, RegistryVersionManifestSchema, toPackageVersion } from '#shared/package.defs';

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

export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodeRouterParams);

  const { from, to } = await getValidatedQuery(event, decodeQueryParams);

  const versionManifests = Effect.all(
    {
      from: registryVersionManifestRequest(packageName, from),
      to: registryVersionManifestRequest(packageName, to),
    },
    { concurrency: 2 },
  );

  // Only tags and noncanonical inputs need to wait for registry version resolution.
  const evidence =
    isExactSemver(from) && isExactSemver(to)
      ? Effect.all(
          { manifests: versionManifests, vulnerabilities: getPackageVulnerabilities(packageName, from, to) },
          { concurrency: 2 },
        )
      : versionManifests.pipe(
          Effect.flatMap((manifests) =>
            getPackageVulnerabilities(packageName, manifests.from.version, manifests.to.version).pipe(
              Effect.map((vulnerabilities) => ({ manifests, vulnerabilities })),
            ),
          ),
        );

  return Effect.runPromise(
    evidence.pipe(
      Effect.map(({ manifests, vulnerabilities }) => ({
        packageName,
        from: { ...toPackageVersion(manifests.from), vulnerabilities: vulnerabilities.from },
        to: { ...toPackageVersion(manifests.to), vulnerabilities: vulnerabilities.to },
      })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
});
