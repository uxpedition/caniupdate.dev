import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { createError, defineEventHandler, getRouterParam } from 'h3';

import { RegistryPackageMetadataSchema, toPackageMetadata } from '#shared/comparison/package/package.defs';

import { RegistryRequestError } from '../../../httpDependencies/npm/errors';
import { getRegistryJson } from '../../../httpDependencies/npm/registry';

const REGISTRY_METADATA_ACCEPT = 'application/vnd.npm.install-v1+json';

export default defineEventHandler(async (event) => {
  const routerSegment = getRouterParam(event, 'packageName');
  if (!routerSegment) throw createError({ statusCode: 400, statusMessage: 'Package name is required' });
  // H3's `decode: true` keeps encoded path separators (`%2F`) encoded, so re-encoding its result would encode a
  // scoped name twice. Decode the router segment once here and encode it once for the registry path.
  const packageName = decodeURIComponent(routerSegment);

  const registryRequest = getRegistryJson(`/${encodeURIComponent(packageName)}`, {
    accept: REGISTRY_METADATA_ACCEPT,
  }).pipe(Effect.mapError((cause) => new RegistryRequestError({ cause })));

  const packageMetadata = Effect.gen(function* () {
    const response = yield* registryRequest;

    const decoded = yield* Schema.decodeUnknownEffect(RegistryPackageMetadataSchema)(response, {
      errors: 'all',
    });

    return toPackageMetadata(decoded);
  });

  return Effect.runPromise(packageMetadata.pipe(Effect.provide(FetchHttpClient.layer)));
});
