import { Data, Effect, Schema } from 'effect';
import { defineEventHandler, getRouterParam } from 'h3';
import npmFetch from 'npm-registry-fetch';

import { RegistryPackageMetadataSchema, toPackageMetadata } from '#shared/package.defs';

const REGISTRY_METADATA_ACCEPT = 'application/vnd.npm.install-v1+json';

const RegistryRequestError = Data.TaggedError('RegistryRequestError')<{
  readonly cause: unknown;
}>;

type RegistryRequestError = InstanceType<typeof RegistryRequestError>;

const registryRequestError = (cause: unknown): RegistryRequestError => new RegistryRequestError({ cause });

export default defineEventHandler(async (event) => {
  const packageName = getRouterParam(event, 'packageName');

  const registryRequest = Effect.tryPromise({
    try: () =>
      npmFetch.json(`/${packageName}`, {
        headers: {
          Accept: REGISTRY_METADATA_ACCEPT,
        },
      }),
    catch: registryRequestError,
  });

  const packageMetadata = Effect.gen(function* () {
    const response = yield* registryRequest;

    const decoded = yield* Schema.decodeUnknownEffect(RegistryPackageMetadataSchema)(response, {
      errors: 'all',
    });

    return toPackageMetadata(decoded);
  });

  return Effect.runPromise(packageMetadata);
});
