import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
  getComparisonMeasurements,
} from '../../../../utils/packageComparisonFacts';

// Sizes, advisories, and inspected-archive summaries for a resolved pair. Kept off the comparison route so a slow
// provider cannot delay declarations.
export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  return Effect.runPromise(
    getComparisonMeasurements(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)),
  );
});
