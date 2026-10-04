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

import { getBriefingEvidence, PackageEvidenceClientError } from '../_internals/evidenceClient';
import { decodePackageComparisonQuery, decodePackageComparisonRouterParams } from '../_internals/request';
import { browserBriefingSocketUrl } from './_internals/socketUrl';

const briefingServiceUnavailable = () =>
  createError({ statusCode: 503, statusMessage: 'Briefing service unavailable' });

type BriefingService = { submit(packet: BriefingEvidence): Promise<unknown> };
type DisposableRpcResult = object & { [Symbol.dispose](): void };

// Cloudflare adds this documented lifecycle hook to every object returned over RPC. It is the sole runtime-owned
// property permitted at this boundary; all application fields remain subject to the strict protocol decoder below.
const isDisposableRpcResult = (value: unknown): value is DisposableRpcResult =>
  typeof value === 'object' &&
  value !== null &&
  typeof Object.getOwnPropertyDescriptor(value, Symbol.dispose)?.value === 'function';

// Copy every own string key, including non-enumerable ones, so strict decoding still rejects undeclared application
// data. When present, the documented disposer is excluded because the caller invokes it unconditionally.
const copyRpcSubmissionData = (submission: unknown): Record<string, unknown> => {
  if (typeof submission !== 'object' || submission === null) {
    throw new TypeError('Briefing service did not return an object');
  }

  const data: Record<string, unknown> = {};

  for (const key of Reflect.ownKeys(submission)) {
    if (key === Symbol.dispose) continue;
    if (typeof key === 'symbol') throw new TypeError('Briefing service returned an unexpected symbol');

    const descriptor = Object.getOwnPropertyDescriptor(submission, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Briefing service returned an accessor property');
    }
    Object.defineProperty(data, key, { enumerable: true, value: descriptor.value });
  }

  return data;
};

// Node's Miniflare bridge omits descriptor values while keeping ordinary property reads live. This is reachable only
// through Nuxt's compile-time development branch below; built Workers retain the descriptor-only path above.
const copyNodeDevelopmentRpcSubmissionData = (submission: unknown): Record<string, unknown> => {
  if (typeof submission !== 'object' || submission === null) {
    throw new TypeError('Briefing service did not return an object');
  }

  const data: Record<string, unknown> = {};

  for (const key of Reflect.ownKeys(submission)) {
    if (typeof key === 'symbol') throw new TypeError('Briefing service returned an unexpected symbol');

    const descriptor = Object.getOwnPropertyDescriptor(submission, key);
    if (descriptor === undefined || descriptor.writable === undefined) {
      throw new TypeError('Briefing service returned an accessor property');
    }
    const value: unknown = Reflect.get(submission, key);
    Object.defineProperty(data, key, { enumerable: true, value });
  }

  return data;
};

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

const receiveBriefingSubmission = async (
  service: BriefingService,
  evidence: BriefingEvidence,
): Promise<BriefingSubmission> => {
  try {
    const rpcSubmission = await service.submit(evidence);
    if (isDisposableRpcResult(rpcSubmission)) {
      const dispose = rpcSubmission[Symbol.dispose];
      try {
        return decodeBriefingSubmission(copyRpcSubmissionData(rpcSubmission));
      } finally {
        dispose.call(rpcSubmission);
      }
    }

    // Nuxt's Node development bridge intentionally hides every symbol on Miniflare RPC proxies. This branch keeps
    // local development usable while retaining the same strict application-field decode; this compile-time Nuxt flag
    // is false in the built Worker, which still requires and invokes Cloudflare's documented lifecycle hook.
    if (import.meta.dev) {
      return decodeBriefingSubmission(copyNodeDevelopmentRpcSubmissionData(rpcSubmission));
    }
    throw new TypeError('Briefing service did not return a disposable object');
  } catch (error) {
    throw refusedSubmission(error);
  }
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

  const submission = await receiveBriefingSubmission(service, evidence);

  // 200 is the stored briefing the page renders; 202 is a job it follows on the service's own socket URL.
  return submissionAnswer(event, submission);
});
