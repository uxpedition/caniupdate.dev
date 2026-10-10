import { Effect, Predicate, Schema, Tracer } from 'effect';
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getValidatedQuery,
  getValidatedRouterParams,
  type H3Event,
} from 'h3';

import type { BriefingEvidence } from '#shared/comparison/briefing/briefing.defs';
import type { BriefingSubmission } from '#shared/comparison/briefing/briefingJob.defs';
import {
  decodeBriefingServiceResult,
  type BriefingServiceResult,
} from '#shared/comparison/briefing/briefingService.defs';
import { runWithTelemetry } from '#shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '#shared/telemetry/telemetryComparison';
import { telemetryWaitUntil } from '#shared/telemetry/telemetryContext';
import { parseTraceparent, type TraceContext } from '#shared/telemetry/traceContext.defs';

import { readServerTelemetryConfig } from '../../../../../telemetry/runtimeConfig';
import { getBriefingEvidence, PackageEvidenceClientError } from '../_internals/evidenceClient';
import { decodePackageComparisonQuery, decodePackageComparisonRouterParams } from '../_internals/request';
import { browserBriefingSocketUrl } from './_internals/socketUrl';

type SubmissionFailureStatus = 'Evidence service unavailable' | 'Briefing service unavailable';

// The RPC envelope is unknown until the copy helpers below flatten its own keys for the strict protocol decoder.
// oxlint-disable-next-line rules/no-unknown-returns -- The service binding's raw envelope is the boundary; the protocol decoder consumes it immediately.
type BriefingService = { submit(packet: BriefingEvidence): Promise<unknown> };

type DisposableRpcResult = object & { [Symbol.dispose](): void };

// Cloudflare adds this documented lifecycle hook to every object returned over RPC. It is the sole runtime-owned
// property permitted at this boundary; all application fields remain subject to the strict protocol decoder below.
const isDisposableRpcResult = (value: unknown): value is DisposableRpcResult =>
  Predicate.isObjectOrArray(value) &&
  Predicate.isFunction(Object.getOwnPropertyDescriptor(value, Symbol.dispose)?.value);

const RpcResultDataSchema = Schema.Record(Schema.String, Schema.Unknown);

type RpcResultData = typeof RpcResultDataSchema.Type;

const isRpcResultObject = Schema.is(Schema.Struct({}));

const isScalarString = Schema.is(Schema.String);

// Copy every own string key, including non-enumerable ones, so strict decoding still rejects undeclared application
// data. When present, the documented disposer is excluded because the caller invokes it unconditionally.
// oxlint-disable-next-line rules/no-unknown-parameters -- The RPC envelope is runtime-owned until the copy below flattens own keys for strict decoding.
const copyRpcServiceResultData = (submission: unknown): RpcResultData => {
  if (!isRpcResultObject(submission)) {
    throw new TypeError('Briefing service did not return an object');
  }

  const data: RpcResultData = {};

  for (const key of Reflect.ownKeys(submission)) {
    if (key === Symbol.dispose) continue;

    if (!isScalarString(key)) throw new TypeError('Briefing service returned an unexpected symbol');

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
// oxlint-disable-next-line rules/no-unknown-parameters -- Same RPC envelope as above, under the descriptor-omitting development bridge.
const copyNodeDevelopmentRpcServiceResultData = (submission: unknown): RpcResultData => {
  if (!isRpcResultObject(submission)) {
    throw new TypeError('Briefing service did not return an object');
  }

  const data: RpcResultData = {};

  for (const key of Reflect.ownKeys(submission)) {
    if (!isScalarString(key)) throw new TypeError('Briefing service returned an unexpected symbol');

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
  // The recorded name distinguishes Error rejections from the runtime's non-Error envelope shapes in diagnostics.
  // oxlint-disable-next-line rules/no-runtime-typeof -- Value-position naming of a non-Error RPC failure, not narrowing.
  const failureName = cause instanceof Error ? cause.name : typeof cause;
  const reason = failureName === SUBMISSION_FAILURE_TAG ? sanitizedFailureReason(cause) : undefined;

  return new BriefingSubmissionFailure(failureName, reason);
};

const receiveBriefingServiceResult = async (
  service: BriefingService,
  evidence: BriefingEvidence,
): Promise<BriefingServiceResult> => {
  try {
    const rpcResult = await service.submit(evidence);

    if (isDisposableRpcResult(rpcResult)) {
      const dispose = rpcResult[Symbol.dispose];

      try {
        return decodeBriefingServiceResult(copyRpcServiceResultData(rpcResult));
      } finally {
        dispose.call(rpcResult);
      }
    }

    // Nuxt's Node development bridge intentionally hides every symbol on Miniflare RPC proxies. This branch keeps
    // local development usable while retaining the same strict application-field decode; this compile-time Nuxt flag
    // is false in the built Worker, which still requires and invokes Cloudflare's documented lifecycle hook.
    if (import.meta.dev) {
      return decodeBriefingServiceResult(copyNodeDevelopmentRpcServiceResultData(rpcResult));
    }

    throw new TypeError('Briefing service did not return a disposable object');
  } catch (error) {
    throw submissionFailure(error);
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

type BriefingSubmissionRequest = { readonly packageName: string; readonly from: string; readonly to: string };

// Decode route and query before evidence I/O so diagnostics only receive validated identity.
const readBriefingSubmissionRequest = async (event: H3Event): Promise<BriefingSubmissionRequest> => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);

  return { packageName, from, to };
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

    yield* Effect.logInfo('briefing.submission.accepted').pipe(
      Effect.annotateLogs({
        traceId: span.traceId,
        spanId: span.spanId,
        ...(parsed === undefined ? {} : { parentSpanId: parsed.spanId }),
        ...(generationContext === undefined ? {} : { linkedGeneration: generationContext }),
        ...identityAttributes,
      }),
    );
  });

const failBriefingSubmission = (
  cause: BriefingSubmissionFailure,
  parsed: TraceContext | undefined,
  identityAttributes: Record<string, string>,
) =>
  Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    yield* Effect.logError('Briefing submission failed').pipe(
      Effect.annotateLogs({
        name: cause.failureName,
        ...(cause.reason === undefined ? {} : { reason: cause.reason }),
        traceId: span.traceId,
        spanId: span.spanId,
        ...(parsed === undefined ? {} : { parentSpanId: parsed.spanId }),
        ...identityAttributes,
      }),
    );

    return yield* Effect.fail(createError({ statusCode: 503, statusMessage: cause.statusMessage }));
  });

const readResolvedBriefingEvidence = (event: H3Event, request: BriefingSubmissionRequest) =>
  Effect.gen(function* () {
    const evidence = yield* Effect.tryPromise({
      try: () =>
        getBriefingEvidence(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, {
          packageName: request.packageName,
          from: request.from,
          to: request.to,
        }),
      catch: (cause) =>
        cause instanceof PackageEvidenceClientError
          ? new BriefingSubmissionFailure(cause.name, cause.reason, 'Evidence service unavailable')
          : cause,
    });

    const identityAttributes = comparisonTelemetryAttributes(evidence, { from: request.from, to: request.to });
    yield* Effect.annotateCurrentSpan(identityAttributes);

    return { evidence, identityAttributes };
  });

const createBriefingSubmissionProgram = (event: H3Event, parsed: TraceContext | undefined) => {
  let identityAttributes: Record<string, string> = {};

  const parent =
    parsed === undefined
      ? undefined
      : Tracer.externalSpan({ traceId: parsed.traceId, spanId: parsed.spanId, sampled: true });

  const spanOptions =
    parent === undefined ? { kind: 'server' as const, root: true } : { kind: 'server' as const, parent };

  return Effect.gen(function* () {
    const request = yield* Effect.tryPromise({
      try: () => readBriefingSubmissionRequest(event),
      catch: (cause) => cause,
    });

    identityAttributes = comparisonTelemetryAttributes(
      { packageName: request.packageName },
      { from: request.from, to: request.to },
    );
    yield* Effect.annotateCurrentSpan(identityAttributes);

    const resolved = yield* readResolvedBriefingEvidence(event, request);
    identityAttributes = resolved.identityAttributes;

    const service = event.context.cloudflare?.env?.BRIEFING_SERVICE;

    if (service === undefined) {
      return yield* Effect.fail(new BriefingSubmissionFailure('BriefingServiceBindingUnavailable'));
    }

    const result = yield* Effect.tryPromise({
      try: () => receiveBriefingServiceResult(service, resolved.evidence),
      catch: (cause) => cause,
    });

    yield* logAcceptedSubmission(parsed, result, identityAttributes);

    return submissionAnswer(event, result.submission);
  }).pipe(
    Effect.catchIf(
      (cause): cause is BriefingSubmissionFailure => cause instanceof BriefingSubmissionFailure,
      (cause) => failBriefingSubmission(cause, parsed, identityAttributes),
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
    {
      serviceName: 'can-i-update-nuxt',
      ...(telemetry.enabled ? { endpoint: telemetry.endpoint, headers: telemetry.headers } : {}),
    },
    telemetryWaitUntil(event.context),
  );
};

export default defineEventHandler((event) => handleBriefingSubmission(event));
