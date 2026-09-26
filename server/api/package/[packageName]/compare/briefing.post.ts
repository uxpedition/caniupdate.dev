import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getValidatedQuery,
  getValidatedRouterParams,
  type H3Event,
} from 'h3';

import type { BriefingEvidence } from '#shared/briefing.defs';
import { decodeBriefingSubmission, type BriefingSubmission } from '#shared/briefingJob.defs';

import { browserBriefingSocketUrl } from '../../../../utils/briefingSocketUrl';
import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
} from '../../../../utils/packageComparisonFacts';
import { getBriefingEvidence, PackageEvidenceClientError } from '../../../../utils/packageEvidenceClient';

const briefingServiceUnavailable = () =>
  createError({ statusCode: 503, statusMessage: 'Briefing service unavailable' });

const SUBMISSION_FAILURE_TAG = 'BriefingSubmissionError';
// Every reason the service's sanitized error type carries is a lowercase token; anything else in an error's text must
// not reach the log, whatever the error is called.
const SANITIZED_REASON_PATTERN = /^[a-z][a-z-]*$/;

const sanitizedFailureReason = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;
  // The service's class carries the reason; across the binding's RPC boundary only its name and message survive, and
  // its message is the reason. The shape guard keeps free text — a provider body, a credential — out of the log.
  const reason = 'reason' in error && typeof error.reason === 'string' ? error.reason : error.message;
  return SANITIZED_REASON_PATTERN.test(reason) ? reason : undefined;
};

/**
 * The one server-side signal a refused submission leaves. The response stays as opaque as it is today; the log carries
 * only the error's name and, for the service's own sanitized error type, its reason. The evidence packet, the prompt,
 * credentials, and raw provider bodies never belong in a log line.
 */
const logSubmissionFailure = (error: unknown): void => {
  const name = error instanceof Error ? error.name : typeof error;
  const reason = name === SUBMISSION_FAILURE_TAG ? sanitizedFailureReason(error) : undefined;
  console.error('Briefing submission failed', reason === undefined ? { name } : { name, reason });
};

/** Leaves the sanitized trail that makes a refused submission diagnosable, then answers the same opaque 503. */
const refusedSubmission = (error: unknown) => {
  logSubmissionFailure(error);
  return briefingServiceUnavailable();
};

/**
 * The two answers this route may give: 200 is the stored briefing the page renders, and 202 is a job it follows on the
 * service's own socket URL — re-pointed at the host the request arrived on whenever the service advertised a loopback
 * one, since only a request knows where its browser is.
 */
const submissionAnswer = (event: H3Event, submission: BriefingSubmission): Response => {
  if (submission.status === 'available') return Response.json(submission, { status: 200 });

  // Which host the browser is on: the page's own Origin, or the Host it reached this route at. Both only ever move the
  // host of the socket URL below, never the job it names.
  const origin = getRequestHeader(event, 'origin');
  const host = getRequestHeader(event, 'host');

  return Response.json(
    { ...submission, eventsUrl: browserBriefingSocketUrl(submission.eventsUrl, origin, host) },
    { status: 202 },
  );
};

// The AI briefing is served separately from factual comparison data, and this route owns no generation: the private
// evidence object builds the bounded packet and the private briefing service owns the hash, the store, the provider
// call, and the subscription URL the browser follows. Nothing here reads a credential or a database, so a missing
// binding or an off-protocol answer is an explicit 503 instead of a job the page could never follow.
//
// POST rather than GET even though it carries no body: this is a submission, not a read. A cold hash creates a job and
// can spend provider budget, and the client issues it on every comparison page view — a GET-shaped URL is what
// browsers prefetch, caches replay and crawlers walk, and none of them may buy a generation. The parameters live in the
// path and query because the browser may name only the package and the compared versions; the packet is built behind
// the binding.
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

  const service = event.context.cloudflare?.env?.BRIEFING_SERVICE;
  if (service === undefined) throw briefingServiceUnavailable();

  let submission: BriefingSubmission;
  try {
    // The service answers with JSON text because workerd decorates objects that cross its RPC boundary with an own
    // `Symbol.dispose`; this decode is strict, so an undeclared key of any kind is refused rather than rendered.
    submission = decodeBriefingSubmission(JSON.parse(await service.submit(evidence)));
  } catch (error) {
    throw refusedSubmission(error);
  }

  // 200 is the stored briefing the page renders; 202 is a job it follows on the service's own socket URL.
  return submissionAnswer(event, submission);
});
