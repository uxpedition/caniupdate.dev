import { Effect, Schema, SchemaTransformation } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { defineEventHandler, getValidatedQuery } from 'h3';

import { RegistryPackagesSearchResponseSchema, toSearchResults } from '#shared/comparison/package/search.defs';

import { RegistryRequestError } from '../../httpDependencies/npm/errors';
import { getRegistryJson } from '../../httpDependencies/npm/registry';

const EndpointQueryParamsSchema = Schema.Struct({
  text: Schema.Trim.pipe(Schema.decode(SchemaTransformation.toLowerCase())).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(64),
  ),
  size: Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 250 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('20')),
  ),
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (queryParams) =>
    Schema.decodeUnknownSync(EndpointQueryParamsSchema)(queryParams, { errors: 'all' }),
  );

  const registryRequest = getRegistryJson('/-/v1/search', { query }).pipe(
    Effect.mapError((cause) => new RegistryRequestError({ cause })),
  );

  const searchResults = Effect.gen(function* () {
    const response = yield* registryRequest;

    const decoded = yield* Schema.decodeUnknownEffect(RegistryPackagesSearchResponseSchema)(response, {
      errors: 'all',
    });

    return toSearchResults(decoded);
  });

  return Effect.runPromise(searchResults.pipe(Effect.provide(FetchHttpClient.layer)));
});
