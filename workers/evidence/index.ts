import type * as Cloudflare from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { Context, Effect, Schema, Tracer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';

import { buildBriefingEvidence } from '../../server/comparison/briefing/evidence/build';
import { getComparisonFacts, getComparisonMeasurements } from '../../server/comparison/collect';
import {
  evidenceFailureReason,
  type EvidenceFailureReason,
  type PackageEvidenceFailure,
} from '../../server/comparison/evidence/errors';
import type { ComparisonEvidenceServices } from '../../server/comparison/evidence/services';
import type { BriefingEvidence } from '../../shared/comparison/briefing/briefing.defs';
import type { PackageMeasurementsResponse } from '../../shared/comparison/comparison.defs';
import { PackageNameSchema } from '../../shared/comparison/package/package.defs';
import { runWithTelemetry } from '../../shared/telemetry/telemetry';
import { comparisonTelemetryAttributes } from '../../shared/telemetry/telemetryComparison';
import { decodeTelemetryHeaders } from '../../shared/telemetry/telemetryConfig.defs';
import { telemetryDecimal } from '../../shared/telemetry/telemetryFields';
import { parseTraceparent } from '../../shared/telemetry/traceContext.defs';
import type { TraceContext } from '../../shared/telemetry/traceContext.defs';
import {
  ArchiveCapacityError,
  BoundedArchiveAdmission,
  BoundedResponseAdmission,
  ResponseCapacityError,
} from './admission';
import { SqlEvidenceCache } from './store';

// These globals belong to workerd; keep their types local instead of replacing Node's globals.
type Request = Cloudflare.Request;

type Response = Cloudflare.Response;

declare const Response: typeof Cloudflare.Response;

const MAX_REQUEST_BYTES = 16 * 1024;

const VERSION_MAX_LENGTH = 256;

const VersionSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));

const EvidenceRequestSchema = Schema.Struct({
  packageName: PackageNameSchema,
  from: VersionSchema,
  to: VersionSchema,
});

const decodeEvidenceRequest = Schema.decodeUnknownSync(EvidenceRequestSchema, { errors: 'all' });

const textEncoder = new TextEncoder();

export type EvidenceRequest = typeof EvidenceRequestSchema.Type;

export type EvidenceEnv = {
  readonly GITHUB_TOKEN?: string;
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  readonly OTEL_EXPORTER_OTLP_HEADERS?: string;
};

type WritableComparisonEvidenceServices = {
  -readonly [K in keyof ComparisonEvidenceServices]: ComparisonEvidenceServices[K];
};

const archiveAdmission = new BoundedArchiveAdmission();

const responseAdmission = new BoundedResponseAdmission();

// Coalesced callers share work, but their request bodies and eventual responses still occupy memory.
const MAX_PENDING_EVIDENCE_REQUESTS = 16;

const requestAdmission = new BoundedResponseAdmission(MAX_PENDING_EVIDENCE_REQUESTS, 'request');

type Collection = PackageMeasurementsResponse | BriefingEvidence;

/** Failure classification for one request; the response status alone cannot distinguish storage from capacity. */
type RequestFailure = { reason?: EvidenceFailureReason };

type EvidenceRequestOutcome =
  | { readonly outcome: 'success' }
  | { readonly outcome: 'failure'; readonly reason: EvidenceFailureReason | 'invalid-input' };

type InFlightValue = { readonly pending: Promise<Collection>; readonly context: TraceContext | undefined };

export class PackageEvidence extends DurableObject<EvidenceEnv> {
  readonly #cache: SqlEvidenceCache | undefined;
  readonly #services: ComparisonEvidenceServices;
  readonly #inFlight = new Map<string, InFlightValue>();
  readonly #storageFailure: unknown;

  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: EvidenceEnv) {
    super(ctx, env);

    try {
      this.#cache = new SqlEvidenceCache(ctx.storage);
      this.#storageFailure = undefined;
    } catch (cause) {
      this.#cache = undefined;
      this.#storageFailure = cause;
      // No request context exists here, so this owner emits its own independent root diagnostic.
      reportStorageInitializeFailure(cause, env, (promise) => ctx.waitUntil(promise));
    }

    const services: WritableComparisonEvidenceServices = { archiveAdmission };

    if (this.#cache !== undefined) services.cache = this.#cache;

    if (env.GITHUB_TOKEN !== undefined) services.githubToken = env.GITHUB_TOKEN;

    this.#services = services;
  }

  async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    const parsed = parseTraceparent(request.headers.get('traceparent'));
    const parent = parsed === undefined ? undefined : Tracer.externalSpan({ ...parsed, sampled: true });
    const identity: Record<string, string> = {};

    return runWithTelemetry(this.#traced(request, identity, started, parent), telemetryConfig(this.env), (promise) =>
      this.ctx.waitUntil(promise),
    );
  }

  // Every request reaches exactly one completion log, including malformed input and storage or capacity failures.
  #traced(
    request: Request,
    identity: Record<string, string>,
    started: number,
    parent: Tracer.ExternalSpan | undefined,
  ): Effect.Effect<Response> {
    return Effect.gen({ self: this }, function* () {
      const context = yield* Effect.context<never>();
      const failure: RequestFailure = {};
      const response = yield* this.#admitted(request, identity, context, failure);

      const outcome: EvidenceRequestOutcome = response.ok
        ? { outcome: 'success' }
        : {
            outcome: 'failure',
            reason:
              failure.reason ?? (response.status >= 400 && response.status < 500 ? 'invalid-input' : 'unexpected'),
          };

      yield* bestEffort(Effect.annotateCurrentSpan(identity));
      yield* bestEffort(
        Effect.logInfo('evidence.request.completed').pipe(
          Effect.annotateLogs({
            ...identity,
            operation: 'request',
            ...outcome,
            statusClass: `${Math.floor(response.status / 100)}xx`,
            durationMs: telemetryDecimal(Date.now() - started),
          }),
        ),
      );

      return response;
    }).pipe(
      Effect.withSpan(
        'evidence.request',
        parent === undefined ? { root: true, kind: 'server' } : { parent, kind: 'server' },
      ),
    );
  }

  // Admission bounds pending requests; any failure here becomes the request's backend response, never a rejection.
  #admitted(
    request: Request,
    identity: Record<string, string>,
    context: Context.Context<never>,
    failure: RequestFailure,
  ): Effect.Effect<Response> {
    return requestAdmission
      .withPermit(
        Effect.tryPromise({ try: () => this.#handle(request, identity, context, failure), catch: (cause) => cause }),
      )
      .pipe(
        Effect.catch((cause) => {
          failure.reason = evidenceFailureReason(cause);

          return Effect.succeed(backendError(cause));
        }),
      );
  }

  async #handle(
    request: Request,
    identity: Record<string, string>,
    context: Context.Context<never>,
    failure: RequestFailure,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method !== 'POST' || (path !== '/measurements' && path !== '/briefing-evidence')) {
      return jsonError('Not found', 404);
    }

    if (this.#storageFailure !== undefined) {
      failure.reason = evidenceFailureReason(this.#storageFailure);

      return jsonError('Evidence storage unavailable', 503);
    }

    const headersError = validateEvidenceHeaders(request);

    if (headersError !== null) return headersError;
    const input = await readEvidenceInput(request);

    if (input instanceof Response) return input;

    const key = `${path}:${JSON.stringify(input)}`;
    const load = path === '/measurements' ? this.#measurements(input) : this.#briefingEvidence(input);
    const result = await this.#coalesce(key, load, context, identity);
    Object.assign(identity, comparisonTelemetryAttributes(result));

    return Response.json(result, { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }

  // Provider requests never carry the caller's traceparent; only the private evidence request is traced across services.
  #measurements(input: EvidenceRequest): Effect.Effect<PackageMeasurementsResponse, PackageEvidenceFailure> {
    return getComparisonMeasurements(input.packageName, input.from, input.to, this.#services).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    );
  }

  #briefingEvidence(input: EvidenceRequest): Effect.Effect<BriefingEvidence, PackageEvidenceFailure> {
    return getComparisonFacts(input.packageName, input.from, input.to, this.#services).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
      Effect.map((facts) => buildBriefingEvidence(facts)),
    );
  }

  async #coalesce(
    key: string,
    load: Effect.Effect<Collection, PackageEvidenceFailure>,
    context: Context.Context<never>,
    annotations: Record<string, string>,
  ): Promise<Collection> {
    const current = this.#inFlight.get(key);

    if (current !== undefined) return this.#join(current, context, annotations);

    return this.#lead(key, load, context, annotations);
  }

  // A joiner waits on the shared collection and links to its root whether that collection resolves or rejects.
  async #join(
    flight: InFlightValue,
    context: Context.Context<never>,
    annotations: Record<string, string>,
  ): Promise<Collection> {
    try {
      return await flight.pending;
    } finally {
      linkSharedCollection(context, annotations, flight, 'joined');
    }
  }

  // The initiator owns the in-flight entry and removes it only after the shared collection settles.
  async #lead(
    key: string,
    load: Effect.Effect<Collection, PackageEvidenceFailure>,
    context: Context.Context<never>,
    annotations: Record<string, string>,
  ): Promise<Collection> {
    const flight = startSharedCollection(load, context);
    this.#inFlight.set(key, flight);

    try {
      return await flight.pending;
    } finally {
      linkSharedCollection(context, annotations, flight);

      if (this.#inFlight.get(key) === flight) this.#inFlight.delete(key);
    }
  }
}

/**
 * Starts the shared collection under its own independent root. The root descriptor is ephemeral: it lives only in the
 * in-flight entry until that entry settles, and joiners read it through `context` once the root span exists.
 */
function startSharedCollection(
  load: Effect.Effect<Collection, PackageEvidenceFailure>,
  context: Context.Context<never>,
): InFlightValue {
  let sharedContext: TraceContext | undefined;

  const collection = load.pipe(
    Effect.tap((result) =>
      bestEffort(
        Effect.gen(function* () {
          const identity = comparisonTelemetryAttributes(result);
          yield* Effect.annotateCurrentSpan(identity);
          yield* Effect.logInfo('evidence.collection.completed').pipe(
            Effect.annotateLogs({ ...identity, operation: 'collection', outcome: 'success' }),
          );
        }),
      ),
    ),
    Effect.tapError((cause) =>
      bestEffort(
        Effect.logInfo('evidence.collection.completed').pipe(
          Effect.annotateLogs({ operation: 'collection', outcome: 'failure', reason: evidenceFailureReason(cause) }),
        ),
      ),
    ),
  );

  const pending = Effect.runPromiseWith(context)(
    Effect.gen(function* () {
      const root = yield* Effect.currentSpan;
      sharedContext = { traceId: root.traceId, spanId: root.spanId };

      return yield* responseAdmission.withPermit(collection);
    }).pipe(Effect.withSpan('evidence.collection', { root: true })),
  );

  return {
    pending,
    get context() {
      return sharedContext;
    },
  };
}

// Diagnostics are best effort: a failing log or annotation never replaces a collection result or rejection.
const bestEffort = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catchCause(() => Effect.void));

/** Link each requesting operation to the independent shared root, including failed work, without copying inputs. */
function linkSharedCollection(
  context: Context.Context<never>,
  annotations: Record<string, string>,
  flight: InFlightValue,
  outcome?: 'joined',
): void {
  try {
    const shared = flight.context;

    if (shared === undefined) return;

    annotations.linkedTraceId = shared.traceId;
    annotations.linkedSpanId = shared.spanId;
    Effect.runSyncWith(context)(
      Effect.gen(function* () {
        const requestSpan = yield* Effect.currentSpan;
        requestSpan.addLinks([
          {
            span: Tracer.externalSpan({ ...shared, sampled: true }),
            attributes: { relationship: 'shared-collection' },
          },
        ]);

        if (outcome !== undefined)
          yield* Effect.logInfo('evidence.cache.decision').pipe(
            Effect.annotateLogs({
              operation: 'collection',
              outcome,
              relationship: 'shared-collection',
              linkedTraceId: shared.traceId,
              linkedSpanId: shared.spanId,
            }),
          );
      }),
    );
  } catch {
    // Linking diagnostics is best effort; it cannot replace a collection result or rejection.
  }
}

function validateEvidenceHeaders(request: Request): Response | null {
  const contentType = request.headers.get('content-type');

  if (contentType !== null && !contentType.toLowerCase().startsWith('application/json')) {
    return jsonError('Expected JSON request', 415);
  }

  const declaredLength = Number(request.headers.get('content-length'));

  return Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES
    ? jsonError('Request is too large', 413)
    : null;
}

async function readEvidenceInput(request: Request): Promise<EvidenceRequest | Response> {
  try {
    const body = await request.text();

    if (textEncoder.encode(body).byteLength > MAX_REQUEST_BYTES) return jsonError('Request is too large', 413);

    return decodeEvidenceRequest(JSON.parse(body));
  } catch {
    return jsonError('Invalid evidence request', 400);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

// Explicit shapes keep an unset exporter endpoint absent rather than present with an undefined value.
function telemetryConfig(env: EvidenceEnv) {
  const headers = decodeTelemetryHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);

  return env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
    ? { serviceName: 'can-i-update-evidence', headers }
    : { serviceName: 'can-i-update-evidence', endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers };
}

// Emits one root diagnostic for a storage failure that happened before any request existed; it never rejects.
function reportStorageInitializeFailure(
  cause: unknown,
  env: EvidenceEnv,
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  const program = Effect.logError('evidence.storage.failed').pipe(
    Effect.annotateLogs({ operation: 'initialize', outcome: 'failure', reason: evidenceFailureReason(cause) }),
  );

  void runWithTelemetry(program, telemetryConfig(env), waitUntil).then(
    () => undefined,
    () => undefined,
  );
}

function backendError(cause: unknown): Response {
  if (cause instanceof ArchiveCapacityError || cause instanceof ResponseCapacityError) {
    return new Response(JSON.stringify({ error: 'Evidence temporarily unavailable' }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': '1',
      },
    });
  }

  return jsonError('Evidence service unavailable', 503);
}

export default {
  fetch: () => new Response('Not Found', { status: 404 }),
};
