// The briefing Worker's entrypoints: a private named entrypoint for submission and D1-only result reads, a read-only
// public default export, and the Queue consumer that wakes one job object per delivery. The public surface never
// submits, enqueues, or reads a packet.

import type * as Cloudflare from '@cloudflare/workers-types';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Schema } from 'effect';

import { briefingEvidenceHash } from '../../server/comparison/briefing/generation';
import { readStoredBriefing } from '../../server/comparison/briefing/store';
import { BriefingEvidenceSchema } from '../../shared/comparison/briefing/briefing.defs';
import type { BriefingEvidence } from '../../shared/comparison/briefing/briefing.defs';
import type { BriefingServiceResult } from '../../shared/comparison/briefing/briefingService.defs';
import { decodeStoredBriefingResult } from '../../shared/comparison/briefing/storedBriefing.defs';
import type { StoredBriefingResult } from '../../shared/comparison/briefing/storedBriefing.defs';
import { decodeRateLimitCaller, type RateLimitCaller } from '../../shared/request/rateLimit.defs';
import type { TelemetryRuntimeOptions, TelemetryWaitUntil } from '../../shared/telemetry/telemetry';
import { briefingAllowedOrigins } from './allowedOrigins';
import { BriefingSubmissionError, decodeQueueJob, type BriefingEnv, type BriefingJobMessage } from './jobState';
import { briefingTelemetryOptions, emitBriefingFlowEvent, type BriefingFlowFields } from './jobTrace';

// Wrangler requires every Durable Object class named by a binding or a migration to be exported from the entrypoint
// module, so the object is re-exported here rather than only from its own module.
export { BriefingJob } from './job';

// These globals belong to workerd; keep their types local instead of replacing Node's globals.
type MessageBatch = Cloudflare.MessageBatch<BriefingJobMessage>;

type Request = Cloudflare.Request;

type Response = Cloudflare.Response;

declare const Response: typeof Cloudflare.Response;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' };

/**
 * The path Task 2 puts in `BriefingSubmission.eventsUrl`. The hash is the evidence digest itself, so a request
 * cannot name a job that belongs to other evidence, and the route owns no way to create one.
 */
const EVENTS_PATH = /^\/api\/briefings\/([0-9a-f]{64})\/events$/;

const decodeEvidence = Schema.decodeUnknownSync(BriefingEvidenceSchema, { errors: 'all' });

/** One Queue decision: the fixed `queue` operation and trigger are supplied here, never by the caller. */
const emitQueueDecision = (
  fields: BriefingFlowFields,
  options: TelemetryRuntimeOptions,
  waitUntil: TelemetryWaitUntil,
): void => {
  emitBriefingFlowEvent(
    'briefing.queue.decision',
    { ...fields, operation: 'queue', trigger: 'queue' },
    options,
    waitUntil,
  );
};

/**
 * Settles one Queue delivery. A body that is not a job pointer is acked rather than retried; a duplicate or stale
 * generation is acked once the object has classified it; only an unexpected failure is retried. The decoded pointer
 * is the only value the object receives.
 */
const settleQueueDelivery = async (
  message: Cloudflare.Message<BriefingJobMessage>,
  env: BriefingEnv,
  options: TelemetryRuntimeOptions,
  waitUntil: TelemetryWaitUntil,
): Promise<void> => {
  const job = decodeQueueJob(message.body);

  if (job === undefined) {
    emitQueueDecision({ outcome: 'ignored', reason: 'malformed' }, options, waitUntil);
    message.ack();

    return;
  }

  try {
    const jobs = env.BRIEFING_JOBS;
    const { delivery, flow } = await jobs.get(jobs.idFromName(job.hash)).run(job);

    const decision: BriefingFlowFields =
      delivery === 'current' ? { outcome: 'ack' } : { outcome: 'ignored', reason: delivery };

    emitQueueDecision({ ...flow, ...decision }, options, waitUntil);
    message.ack();
  } catch {
    emitQueueDecision({ outcome: 'retry', reason: 'unexpected' }, options, waitUntil);
    message.retry();
  }
};

/**
 * Nuxt's private submission path. It only addresses the job that the decoded packet hashes to; the object itself
 * re-derives and verifies that identity before it stores anything.
 *
 * The envelope crosses the RPC boundary as a native object. workerd attaches its own `Symbol.dispose` on the caller's
 * deserialized result; the Nuxt boundary recognizes and invokes only that lifecycle hook before strictly decoding the
 * application fields.
 */
export class BriefingSubmitter extends WorkerEntrypoint<BriefingEnv> {
  async submit(packet: BriefingEvidence, caller: RateLimitCaller): Promise<BriefingServiceResult> {
    let evidence: BriefingEvidence;

    try {
      evidence = decodeEvidence(packet);
      caller = decodeRateLimitCaller(caller);
    } catch {
      throw new BriefingSubmissionError('invalid-response');
    }

    const jobs = this.env.BRIEFING_JOBS;

    return jobs.get(jobs.idFromName(briefingEvidenceHash(evidence))).submit(evidence, caller);
  }

  /** Read only the D1 success row; a miss never looks up or mutates a Durable Object job. */
  async read(packet: BriefingEvidence): Promise<StoredBriefingResult> {
    let evidence: BriefingEvidence;

    try {
      evidence = decodeEvidence(packet);
    } catch {
      throw new BriefingSubmissionError('invalid-response');
    }

    let briefing;

    try {
      briefing = await readStoredBriefing(this.env.BRIEFINGS_DB, briefingEvidenceHash(evidence));
    } catch {
      throw new BriefingSubmissionError('cache-error');
    }

    try {
      return decodeStoredBriefingResult(
        briefing === undefined
          ? { status: 'missing', packageName: evidence.packageName, from: evidence.from, to: evidence.to }
          : { status: 'available', packageName: evidence.packageName, from: evidence.from, to: evidence.to, briefing },
      );
    } catch {
      throw new BriefingSubmissionError('invalid-response');
    }
  }
}

export default {
  /**
   * The public hostname serves exactly one thing: a read-only socket upgrade for a job this Worker already owns.
   * Submissions, dispatched packets, and provider controls stay reachable by binding only, so every request that is
   * not a browser upgrade from one of the configured Origins is refused here — and nothing on this path writes,
   * enqueues, or generates.
   */
  async fetch(request: Request, env: BriefingEnv): Promise<Response> {
    if (request.method === 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: JSON_HEADERS });
    }

    const hash = request.method === 'GET' ? EVENTS_PATH.exec(new URL(request.url).pathname)?.at(1) : undefined;

    if (hash === undefined) {
      return new Response('Not Found', { status: 404, headers: TEXT_HEADERS });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426, headers: TEXT_HEADERS });
    }

    // One of the exact configured Origins, never a prefix or suffix of one: a look-alike site must not read a briefing.
    if (!briefingAllowedOrigins(env.BRIEFING_ALLOWED_ORIGIN).includes(request.headers.get('Origin') ?? '')) {
      return new Response('Forbidden', { status: 403, headers: TEXT_HEADERS });
    }

    // The object answers its own 101 with the accepted client end; this route only relays the upgrade.
    const jobs = env.BRIEFING_JOBS;

    return await jobs.get(jobs.idFromName(hash)).fetch(request);
  },

  /** One delivery at a time; the object decides whether this generation still needs work. */
  async queue(batch: MessageBatch, env: BriefingEnv, ctx: Cloudflare.ExecutionContext): Promise<void> {
    const options = briefingTelemetryOptions(env.OTEL_EXPORTER_OTLP_ENDPOINT, env.OTEL_EXPORTER_OTLP_HEADERS);
    const waitUntil = ctx.waitUntil.bind(ctx);

    for (const message of batch.messages) {
      await settleQueueDelivery(message, env, options, waitUntil);
    }
  },
};
