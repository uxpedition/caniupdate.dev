import type * as Cloudflare from '@cloudflare/workers-types';

import type {
  AvailablePackageBriefing,
  BriefingEvidence,
  BriefingUnavailableReason,
} from '../../shared/comparison/briefing/briefing.defs';
import type { BriefingJobEvent, BriefingSubmission } from '../../shared/comparison/briefing/briefingJob.defs';
import type { TraceContext } from '../../shared/telemetry/traceContext.defs';
import type { BriefingJob } from './job';

/** The single storage key under which a job object keeps its record. */
export const JOB_KEY = 'job';

/** The Queue message is a pointer, never evidence: the object already owns the immutable packet. */
export type BriefingJobMessage = {
  readonly hash: string;
  readonly generationId: number;
};

/**
 * Everything one evidence hash needs to survive a crash: the immutable packet while the job is pending, the
 * generation that owns dispatch, and the fencing token that keeps a stale owner from committing.
 */
export type JobRecord = {
  readonly hash: string;
  readonly generationId: number;
  readonly revision: number;
  readonly state: 'queued' | 'running' | 'available' | 'unavailable';
  readonly dispatchAttempts: number;
  /** Optional diagnostic link for a pending generation; discarded by every terminal commit. */
  traceContext?: TraceContext;
  /** Present only while the job is queued or running; discarded by every terminal commit. */
  packet?: BriefingEvidence;
  leaseUntil?: number;
  fence?: number;
  reason?: BriefingUnavailableReason;
};

/** Mutable view of the stored JobRecord contract, used only while a terminal record is being assembled. */
type WritableJobRecord = { -readonly [K in keyof JobRecord]: JobRecord[K] };

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

/**
 * A submission the object cannot turn into a queued job or an available result. `message` is the sanitized reason
 * because a rejection crosses the service binding, and workerd RPC carries only an error's name and message: no
 * packet, prompt, endpoint, or credential may ride along.
 */
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

/** A terminal record keeps the correctness state and drops the pending packet, trace context, and lease. */
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

/** The socket and RPC frame of an unavailable job: its revision and its fixed reason. */
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
