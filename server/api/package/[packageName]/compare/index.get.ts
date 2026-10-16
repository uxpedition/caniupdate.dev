import { Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { defineEventHandler } from 'h3';

import { getComparisonDeclarations } from '../../../../comparison/collect';
import { runComparisonRequest } from './_internals/telemetry';

export default defineEventHandler((event) =>
  runComparisonRequest(event, 'declarations', ({ packageName, from, to }) =>
    getComparisonDeclarations(packageName, from, to).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ),
);
