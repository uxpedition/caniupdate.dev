import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
  getComparisonFacts,
} from '../../../../utils/packageComparisonFacts';

export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  return Effect.runPromise(getComparisonFacts(packageName, from, to).pipe(Effect.provide(FetchHttpClient.layer)));
});
