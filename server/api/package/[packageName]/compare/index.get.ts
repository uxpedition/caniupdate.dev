import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientError } from 'effect/http';
import { createError, defineEventHandler } from 'h3';

import { getComparisonDeclarations } from '../../../../comparison/collect';
import { RegistryRequestError } from '../../../../httpDependencies/npm/errors';
import { runComparisonRequest } from './_internals/telemetry';

export default defineEventHandler((event) =>
  runComparisonRequest(event, 'declarations', ({ packageName, from, to }) =>
    getComparisonDeclarations(packageName, from, to).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
      Effect.mapError((error) => {
        const missing =
          error instanceof RegistryRequestError &&
          HttpClientError.isHttpClientError(error.cause) &&
          error.cause.reason instanceof HttpClientError.StatusCodeError &&
          error.cause.reason.response.status === 404;

        return createError({
          statusCode: missing ? 404 : 503,
          statusMessage: missing ? 'Package or version not found' : 'Package declarations unavailable',
        });
      }),
    ),
  ),
);
