import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import { getPackageBriefing } from '../../../../utils/packageBriefing';
import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
  getComparisonFacts,
} from '../../../../utils/packageComparisonFacts';

// The AI summary is served separately from the factual comparison so clients can render facts without waiting for
// inference. Evidence comes from the same server-side collection as the comparison route.
export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  // The store is the request's own binding. An environment without it fails the briefing; it never falls back.
  const database = event.context.cloudflare?.env?.BRIEFINGS_DB;
  return Effect.runPromise(
    getComparisonFacts(packageName, from, to).pipe(
      Effect.flatMap((facts) =>
        getPackageBriefing(facts, database).pipe(
          Effect.map((briefing) => ({
            packageName,
            from: facts.from.version,
            to: facts.to.version,
            briefing,
          })),
        ),
      ),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
});
