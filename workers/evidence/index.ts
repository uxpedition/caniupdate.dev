import type * as Cloudflare from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { buildBriefingEvidence } from '../../server/comparison/briefing/evidence/build';
import { getComparisonFacts, getComparisonMeasurements } from '../../server/comparison/collect';
import type { ComparisonEvidenceServices } from '../../server/comparison/evidence/services';
import type { BriefingEvidence } from '../../shared/comparison/briefing/briefing.defs';
import type { PackageMeasurementsResponse } from '../../shared/comparison/comparison.defs';
import { PackageNameSchema } from '../../shared/comparison/package/package.defs';
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
};

type WritableComparisonEvidenceServices = {
  -readonly [K in keyof ComparisonEvidenceServices]: ComparisonEvidenceServices[K];
};

const archiveAdmission = new BoundedArchiveAdmission();

const responseAdmission = new BoundedResponseAdmission();

// Coalesced callers share work, but their request bodies and eventual responses still occupy memory.
const MAX_PENDING_EVIDENCE_REQUESTS = 16;

const requestAdmission = new BoundedResponseAdmission(MAX_PENDING_EVIDENCE_REQUESTS, 'request');

type InFlightValue = Promise<PackageMeasurementsResponse | BriefingEvidence>;

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
    }

    const services: WritableComparisonEvidenceServices = { archiveAdmission };

    if (this.#cache !== undefined) services.cache = this.#cache;

    if (env.GITHUB_TOKEN !== undefined) services.githubToken = env.GITHUB_TOKEN;

    this.#services = services;
  }

  async fetch(request: Request): Promise<Response> {
    return await Effect.runPromise(
      requestAdmission
        .withPermit(
          Effect.tryPromise({
            try: () => this.#handle(request),
            catch: (cause) => cause,
          }),
        )
        .pipe(Effect.catch((cause) => Effect.succeed(backendError(cause)))),
    );
  }

  async #handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method !== 'POST' || (path !== '/measurements' && path !== '/briefing-evidence')) {
      return jsonError('Not found', 404);
    }

    if (this.#storageFailure !== undefined) return jsonError('Evidence storage unavailable', 503);
    const headersError = validateEvidenceHeaders(request);

    if (headersError !== null) return headersError;
    const input = await readEvidenceInput(request);

    if (input instanceof Response) return input;

    const key = `${path}:${JSON.stringify(input)}`;
    const load = path === '/measurements' ? () => this.#measurements(input) : () => this.#briefingEvidence(input);
    const result = await this.#coalesce(key, load);

    return Response.json(result, { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }

  #measurements(input: EvidenceRequest) {
    return Effect.runPromise(
      getComparisonMeasurements(input.packageName, input.from, input.to, this.#services).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    );
  }

  #briefingEvidence(input: EvidenceRequest): Promise<BriefingEvidence> {
    return Effect.runPromise(
      getComparisonFacts(input.packageName, input.from, input.to, this.#services).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.map((facts) => buildBriefingEvidence(facts)),
      ),
    );
  }

  async #coalesce(
    key: string,
    load: () => Promise<PackageMeasurementsResponse | BriefingEvidence>,
  ): Promise<PackageMeasurementsResponse | BriefingEvidence> {
    const current = this.#inFlight.get(key);

    if (current !== undefined) return await current;

    const pending = Effect.runPromise(
      responseAdmission.withPermit(
        Effect.tryPromise({
          try: load,
          catch: (cause) => cause,
        }),
      ),
    );

    this.#inFlight.set(key, pending);

    try {
      return await pending;
    } finally {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    }
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
