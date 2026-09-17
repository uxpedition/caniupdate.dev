import { Data, Effect, Schema, SchemaTransformation } from 'effect';
import { defineEventHandler, getValidatedQuery } from 'h3';
import npmFetch from 'npm-registry-fetch';

import { RegistryPackagesSearchResponseSchema, toSearchResults } from '#shared/search.defs';

const EndpointQueryParamsSchema = Schema.Struct({
  text: Schema.Trim.pipe(Schema.decode(SchemaTransformation.toLowerCase())).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(64),
  ),
  size: Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 250 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('20')),
  ),
});

const RegistryRequestError = Data.TaggedError('RegistryRequestError')<{
  readonly cause: unknown;
}>;

type RegistryRequestError = InstanceType<typeof RegistryRequestError>;

const registryRequestError = (cause: unknown): RegistryRequestError => new RegistryRequestError({ cause });

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (queryParams) =>
    Schema.decodeUnknownSync(EndpointQueryParamsSchema)(queryParams, { errors: 'all' }),
  );

  const registryRequest = Effect.tryPromise({
    try: () =>
      npmFetch.json('/-/v1/search', {
        query,
      }),
    catch: registryRequestError,
  });

  const searchResults = Effect.gen(function* () {
    const response = yield* registryRequest;

    const decoded = yield* Schema.decodeUnknownEffect(RegistryPackagesSearchResponseSchema)(response, {
      errors: 'all',
    });

    return toSearchResults(decoded);
  });

  return Effect.runPromise(searchResults);
});
