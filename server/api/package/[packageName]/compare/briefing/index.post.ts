import { Effect, Schema, Tracer } from 'effect';
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getValidatedQuery,
  getValidatedRouterParams,
  type H3Event,
} from 'h3';

import type { BriefingSubmission } from '#shared/comparison/briefing/briefingJob.defs';
import {
  decodeBriefingServiceResult,
  type BriefingServiceResult,
} from '#shared/comparison/briefing/briefingService.defs';
import { runWithTelemetry } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryWaitUntil } from '#shared/telemetry/telemetryContext';
import { telemetryDecimal } from '#shared/telemetry/telemetryFields';
import { parseTraceparent, type TraceContext } from '#shared/telemetry/traceContext.defs';

import { admitPublicRequest, rateLimitError } from '../../../../../request/rateLimit';
import { readServerTelemetryConfig } from '../../../../../telemetry/runtimeConfig';
import { getBriefingEvidence, PackageEvidenceClientError } from '../_internals/evidenceClient';
import { decodePackageComparisonQuery, decodePackageComparisonRouterParams } from '../_internals/request';
import { tracedEvidenceRequest } from '../_internals/telemetry';
import { receiveServiceRpcResult } from './_internals/serviceRpc';
import { browserBriefingSocketUrl } from './_internals/socketUrl';

type SubmissionFailureStatus = 'Evidence service unavailable' | 'Briefing service unavailable';

const isScalarString = Schema.is(Schema.String);

const SUBMISSION_FAILURE_TAG = 'BriefingSubmissionError';

// Every reason the service's sanitized error type carries is a lowercase token; anything else in an error's text must
// not reach the log, whatever the error is called.
const SANITIZED_REASON_PATTERN = /^[a-z][a-z-]*$/;

const sanitizedFailureReason = (cause: unknown): string | undefined => {
  if (!(cause instanceof Error)) return undefined;
  // The service's class carries the reason; across the binding's RPC boundary only its name and message survive, and
  // its message is the reason. The shape guard keeps free text — a provider body, a credential — out of the log.
  const reason = 'reason' in cause && isScalarString(cause.reason) ? cause.reason : cause.message;

  return SANITIZED_REASON_PATTERN.test(reason) ? reason : undefined;
};

class BriefingSubmissionFailure extends Error {
  readonly _tag = 'BriefingSubmissionFailure';

  constructor(
    readonly failureName: string,
    readonly reason?: string,
    readonly statusMessage: SubmissionFailureStatus = 'Briefing service unavailable',
  ) {
    super('Briefing submission refused');
  }
}

const submissionFailure = (cause: unknown): BriefingSubmissionFailure => {
  /*
   * RPC promises can reject with non-Errors. Record their runtime category without logging the rejected value,
   * which may contain credentials or provider response text. This label is diagnostic only; the HTTP response
   * stays a generic 503. Schema/Predicate checks would duplicate typeof's classification, not validate a contract.
   */
  // oxlint-disable-next-line rules/no-runtime-typeof -- Diagnostic type label for non-Error rejections; no decoding or narrowing.
  const failureName = cause instanceof Error ? cause.name : typeof cause;
  const reason = failureName === SUBMISSION_FAILURE_TAG ? sanitizedFailureReason(cause) : undefined;

  return new BriefingSubmissionFailure(failureName, reason);
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

type BriefingSubmissionRequest = { readonly packageName: string; readonly from: string; readonly to: string };

// Decode route and query before evidence I/O so diagnostics only receive validated identity.
const readBriefingSubmissionRequest = async (event: H3Event): Promise<BriefingSubmissionRequest> => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);

  return { packageName, from, to };
};

type AcceptedSubmissionAnnotations = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  linkedTraceId?: string;
  linkedSpanId?: string;
  outcome: BriefingSubmission['status'];
};

type FailedSubmissionAnnotations = {
  name: string;
  traceId: string;
  spanId: string;
  reason?: string;
  parentSpanId?: string;
};

const logAcceptedSubmission = (
  parsed: TraceContext | undefined,
  result: BriefingServiceResult,
  identityAttributes: Record<string, string>,
) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    const generationContext = result.generationContext;

    if (generationContext !== undefined) {
      yield* Effect.sync(() =>
        span.addLinks([
          {
            span: Tracer.externalSpan({ ...generationContext, sampled: true }),
            attributes: { relationship: 'shared-generation' },
          },
        ]),
      );
    }

    // Optional keys are set only when present so absent fields stay absent in exported logs (not set to undefined).
    const annotations: AcceptedSubmissionAnnotations = {
      traceId: span.traceId,
      spanId: span.spanId,
      outcome: result.submission.status,
    };

    if (parsed !== undefined) annotations.parentSpanId = parsed.spanId;

    if (generationContext !== undefined) {
      annotations.linkedTraceId = generationContext.traceId;
      annotations.linkedSpanId = generationContext.spanId;
    }

    Object.assign(annotations, identityAttributes);

    yield* Effect.logInfo('briefing.submission.accepted').pipe(Effect.annotateLogs(annotations));
  });

const failBriefingSubmission = (
  cause: BriefingSubmissionFailure,
  parsed: TraceContext | undefined,
  identityAttributes: Record<string, string>,
  event: H3Event,
) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan;

    // Optional keys are set only when present so absent fields stay absent in exported logs (not set to undefined).
    const annotations: FailedSubmissionAnnotations = {
      name: cause.failureName,
      traceId: span.traceId,
      spanId: span.spanId,
    };

    if (cause.reason !== undefined) annotations.reason = cause.reason;

    if (parsed !== undefined) annotations.parentSpanId = parsed.spanId;
    Object.assign(annotations, identityAttributes);

    yield* Effect.logError('Briefing submission failed').pipe(Effect.annotateLogs(annotations));

    if (cause.reason === 'generation-rate-limited') {
      return yield* Effect.fail(rateLimitError(event, 'generation-rate-limited'));
    }

    return yield* Effect.fail(createError({ statusCode: 503, statusMessage: cause.statusMessage }));
  });

const readResolvedBriefingEvidence = (event: H3Event, request: BriefingSubmissionRequest) =>
  Effect.gen(function* () {
    const evidence = yield* tracedEvidenceRequest('briefing', (context) =>
      getBriefingEvidence(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, request, context),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof PackageEvidenceClientError
          ? new BriefingSubmissionFailure(cause.name, cause.reason, 'Evidence service unavailable')
          : cause,
      ),
    );

    const identityAttributes = comparisonTelemetryAttributes(evidence);
    yield* Effect.annotateCurrentSpan(identityAttributes);

    return { evidence, identityAttributes };
  });

const logBriefingRequestRejection = (started: number) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    yield* Effect.logWarning('comparison.request.rejected').pipe(
      Effect.annotateLogs({
        traceId: span.traceId,
        spanId: span.spanId,
        operation: 'briefing',
        outcome: 'failure',
        reason: 'invalid-input',
        statusClass: '4xx',
        durationMs: telemetryDecimal(Date.now() - started),
      }),
    );
  });

const createBriefingSubmissionProgram = (event: H3Event, parsed: TraceContext | undefined) => {
  const started = Date.now();
  let identityAttributes: Record<string, string> = {};

  const parent =
    parsed === undefined
      ? undefined
      : Tracer.externalSpan({ traceId: parsed.traceId, spanId: parsed.spanId, sampled: true });

  const spanOptions =
    parent === undefined ? { kind: 'server' as const, root: true } : { kind: 'server' as const, parent };

  return Effect.gen(function* () {
    const caller = yield* Effect.tryPromise({
      try: async () => event.context.rateLimitCaller ?? (await admitPublicRequest(event)),
      catch: (cause) => cause,
    });

    const request = yield* Effect.tryPromise({
      try: () => readBriefingSubmissionRequest(event),
      catch: (cause) => cause,
    }).pipe(Effect.tapError(() => logBriefingRequestRejection(started)));

    const resolved = yield* readResolvedBriefingEvidence(event, request);
    identityAttributes = resolved.identityAttributes;

    const service = event.context.cloudflare?.env?.BRIEFING_SERVICE;

    if (service === undefined) {
      return yield* Effect.fail(new BriefingSubmissionFailure('BriefingServiceBindingUnavailable'));
    }

    const result = yield* Effect.tryPromise({
      try: () => receiveServiceRpcResult(() => service.submit(resolved.evidence, caller), decodeBriefingServiceResult),
      catch: submissionFailure,
    });

    yield* logAcceptedSubmission(parsed, result, identityAttributes);

    return submissionAnswer(event, result.submission);
  }).pipe(
    Effect.catchIf(
      (cause): cause is BriefingSubmissionFailure => cause instanceof BriefingSubmissionFailure,
      (cause) => failBriefingSubmission(cause, parsed, identityAttributes, event),
    ),
    Effect.withSpan('briefing.submit', spanOptions),
  );
};

const handleBriefingSubmission = async (event: H3Event) => {
  const parsed = parseTraceparent(getRequestHeader(event, 'traceparent'));
  const program = createBriefingSubmissionProgram(event, parsed);
  const telemetry = readServerTelemetryConfig(event);

  return runWithTelemetry(
    program,
    telemetry.enabled
      ? { serviceName: 'can-i-update-nuxt', endpoint: telemetry.endpoint, headers: telemetry.headers }
      : { serviceName: 'can-i-update-nuxt' },
    telemetryWaitUntil(event.context),
  );
};

export default defineEventHandler((event) => handleBriefingSubmission(event));
