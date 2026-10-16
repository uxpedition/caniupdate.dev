import type * as Cloudflare from '@cloudflare/workers-types';
import { Schema } from 'effect';

import type {
  AvailablePackageBriefing,
  BriefingEvidence,
  BriefingUnavailableReason,
} from '../../shared/comparison/briefing/briefing.defs';
import type { BriefingJobEvent, BriefingSubmission } from '../../shared/comparison/briefing/briefingJob.defs';
import type { TraceContext } from '../../shared/telemetry/traceContext.defs';
import type { BriefingJob } from './job';
import type { BriefingFlowCorrelation } from './jobTrace';

/** The single storage key under which a job object keeps its record. */
export const JOB_KEY = 'job';

/** The Queue message is a pointer, never evidence; the object owns the immutable packet. */
export type BriefingJobMessage = { readonly hash: string; readonly generationId: number };

/** Pending packet/context are discarded at settlement; generation and fencing remain correctness state. */
export type JobRecord = {
  readonly hash: string;
  readonly generationId: number;
  readonly revision: number;
  readonly state: 'queued' | 'running' | 'available' | 'unavailable';
  readonly dispatchAttempts: number;
  traceContext?: TraceContext;
  packet?: BriefingEvidence;
  leaseUntil?: number;
  fence?: number;
  reason?: BriefingUnavailableReason;
};

export type WritableJobRecord = { -readonly [K in keyof JobRecord]: JobRecord[K] };

export type BriefingEnv = {
  readonly BRIEFING_JOBS: Cloudflare.DurableObjectNamespace<BriefingJob>;
  readonly BRIEFING_QUEUE: Cloudflare.Queue<BriefingJobMessage>;
  readonly BRIEFINGS_DB: Cloudflare.D1Database;
  readonly BRIEFING_PUBLIC_URL: string;
  readonly BRIEFING_ALLOWED_ORIGIN: string;
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  readonly OTEL_EXPORTER_OTLP_HEADERS?: string;
  readonly AI_BRIEFING_ENDPOINT?: string;
  readonly AI_BRIEFING_API_KEY?: string;
  readonly AI_BRIEFING_MODEL?: string;
};

/** RPC transports only name/message: every message here is a fixed domain reason, never provider prose. */
export class BriefingSubmissionError extends Error {
  readonly _tag = 'BriefingSubmissionError';
  readonly reason: BriefingUnavailableReason;

  constructor(reason: BriefingUnavailableReason) {
    super(reason);
    this.name = 'BriefingSubmissionError';
    this.reason = reason;
  }
}

export type TerminalOutcome =
  | { readonly state: 'available'; readonly briefing: AvailablePackageBriefing }
  | { readonly state: 'unavailable'; readonly reason: BriefingUnavailableReason };

/** A terminal record preserves correctness state and deliberately discards the pending packet, trace, and lease. */
export const terminalJobRecord = (record: JobRecord, outcome: TerminalOutcome): JobRecord => {
  const settled: WritableJobRecord = {
    hash: record.hash,
    generationId: record.generationId,
    revision: record.revision + 1,
    state: outcome.state,
    dispatchAttempts: record.dispatchAttempts,
  };

  if (record.fence !== undefined) settled.fence = record.fence;

  if (outcome.state === 'unavailable') settled.reason = outcome.reason;

  return settled;
};

/** A miss may generate; failure never means an empty successful lookup. */
export type StoredLookup =
  | { readonly outcome: 'found'; readonly briefing: AvailablePackageBriefing }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'failed' };

/** Delivery classification travels only over private RPC; no Queue bodies enter diagnostics. */
export type BriefingQueueDelivery = {
  readonly delivery: 'current' | 'duplicate' | 'stale';
  readonly flow: BriefingFlowCorrelation;
  readonly event: BriefingJobEvent;
};

/** The socket and RPC frame of a settled job: its revision and, when unavailable, its fixed reason. */
export const unavailableEvent = (record: JobRecord): BriefingJobEvent => ({
  status: 'unavailable',
  revision: record.revision,
  reason: record.reason ?? 'cache-error',
});

/** The envelope for a submission still queued or running, addressed by the events URL of the public Worker. */
export const pendingSubmission = (
  record: JobRecord,
  evidence: BriefingEvidence,
  publicUrl: string,
): BriefingSubmission => ({
  status: record.state === 'running' ? 'running' : 'queued',
  packageName: evidence.packageName,
  from: evidence.from,
  to: evidence.to,
  hash: record.hash,
  eventsUrl: `${publicUrl.replace(/\/+$/, '')}/api/briefings/${record.hash}/events`,
  revision: record.revision,
});

/** The envelope for a submission answered from D1: the stored briefing is the whole result. */
export const availableSubmission = (
  evidence: BriefingEvidence,
  briefing: AvailablePackageBriefing,
): BriefingSubmission => ({
  status: 'available',
  packageName: evidence.packageName,
  from: evidence.from,
  to: evidence.to,
  briefing,
});

// The Queue is an internal wake-up channel, so a body that is not a job pointer is dropped rather than retried: it
// could only address an object with no evidence and no generation.
const JobMessageSchema = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/, { expected: '64 lowercase hexadecimal characters' })),
  generationId: Schema.Natural,
});

const decodeJobMessage = Schema.decodeUnknownSync(JobMessageSchema, { errors: 'all' });

/** The decoded pointer, or undefined. The Queue body is decoded once and only the decoded value is used after this. */
export function decodeQueueJob<Body>(body: Body): BriefingJobMessage | undefined {
  try {
    return decodeJobMessage(body);
  } catch {
    return undefined;
  }
}
