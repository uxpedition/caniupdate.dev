// The briefing Worker's entrypoints: a private named entrypoint for submission, a read-only public default export,
// and the Queue consumer that wakes one job object per delivery. The public surface never submits, enqueues, or reads
// a packet.

import type * as Cloudflare from '@cloudflare/workers-types';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Schema } from 'effect';

import { briefingEvidenceHash } from '../../server/utils/packageBriefing';
import { BriefingEvidenceSchema } from '../../shared/briefing.defs';
import type { BriefingEvidence } from '../../shared/briefing.defs';
import { briefingAllowedOrigins } from './allowedOrigins';
import { BriefingSubmissionError, type BriefingEnv, type BriefingJobMessage } from './job';

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

// The Queue is an internal wake-up channel, so a body that is not a job pointer is dropped rather than retried: it
// could only address an object with no evidence and no generation.
const JobMessageSchema = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/, { expected: '64 lowercase hexadecimal characters' })),
  generationId: Schema.Natural,
});
const decodeJobMessage = Schema.decodeUnknownSync(JobMessageSchema, { errors: 'all' });

function isJobMessage(value: unknown): value is BriefingJobMessage {
  try {
    decodeJobMessage(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nuxt's private submission path. It only addresses the job that the decoded packet hashes to; the object itself
 * re-derives and verifies that identity before it stores anything.
 *
 * The envelope crosses the RPC boundary as JSON text on purpose: workerd attaches an own `Symbol.dispose` to every
 * object it deserializes for a caller, and the frontend decodes the envelope strictly, where an undeclared key —
 * symbol or not — is an error. A string carries exactly what the envelope declares.
 */
export class BriefingSubmitter extends WorkerEntrypoint<BriefingEnv> {
  async submit(packet: BriefingEvidence): Promise<string> {
    let evidence: BriefingEvidence;
    try {
      evidence = decodeEvidence(packet);
    } catch {
      throw new BriefingSubmissionError('invalid-response');
    }

    const jobs = this.env.BRIEFING_JOBS;
    return JSON.stringify(await jobs.get(jobs.idFromName(briefingEvidenceHash(evidence))).submit(evidence));
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
  async queue(batch: MessageBatch, env: BriefingEnv): Promise<void> {
    for (const message of batch.messages) {
      if (!isJobMessage(message.body)) {
        message.ack();
        continue;
      }
      try {
        const jobs = env.BRIEFING_JOBS;
        await jobs.get(jobs.idFromName(message.body.hash)).run(message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
