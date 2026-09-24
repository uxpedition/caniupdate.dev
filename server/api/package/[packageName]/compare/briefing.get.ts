import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { createError, defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import type { BriefingEvidence } from '#shared/briefing.defs';

import { getPackageBriefing } from '../../../../utils/packageBriefing';
import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
} from '../../../../utils/packageComparisonFacts';
import { getBriefingEvidence, PackageEvidenceClientError } from '../../../../utils/packageEvidenceClient';

// The AI summary is served separately from factual comparison data. Both evidence and packet construction stay in the
// private package object; this request only forwards the bounded packet to the existing D1/AI pipeline.
export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  let evidence: BriefingEvidence;
  try {
    evidence = await getBriefingEvidence(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, { packageName, from, to });
  } catch (error) {
    if (error instanceof PackageEvidenceClientError) {
      throw createError({ statusCode: 503, statusMessage: 'Evidence service unavailable' });
    }
    throw error;
  }

  // The store is the request's own binding. An environment without it produces the existing unavailable response;
  // no process-global database or local evidence fallback is substituted.
  const database = event.context.cloudflare?.env?.BRIEFINGS_DB;
  return Effect.runPromise(
    getPackageBriefing(evidence, database).pipe(
      Effect.map((briefing) => ({
        packageName: evidence.packageName,
        from: evidence.from,
        to: evidence.to,
        briefing,
      })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
});
