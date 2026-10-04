// The per-evidence-hash job object: one SQLite-backed Durable Object owns generation, D1 reconciliation, dispatch
// recovery, and (from Task 3) socket subscribers. The Queue only wakes this object; the packet, the prompt, and the
// provider credential never travel through it.
//
// Ordering rules this file must keep:
// - The bounded packet and the generation are stored before a submission is acknowledged, and the dispatch-recovery
//   alarm is set before the Queue is asked to accept the message.
// - D1 is read before any provider call. A read failure prevents the call; a write failure is never durable success.
// - A terminal commit is first-writer-wins and drops the packet, so a stale owner cannot overwrite a settled job.

import type * as Cloudflare from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';

import { briefingEvidenceHash, generateBriefing, readBriefingConfig } from '../../server/comparison/briefing/generation';
import { isBriefingStoreFailure, readStoredBriefing, saveBriefing } from '../../server/comparison/briefing/store';
import { BriefingEvidenceSchema } from '../../shared/briefing.defs';
import type {
  AvailablePackageBriefing,
  BriefingEvidence,
  BriefingUnavailableReason,
  PackageBriefing,
} from '../../shared/briefing.defs';
import type { BriefingJobEvent, BriefingSubmission } from '../../shared/briefingJob.defs';

// These globals belong to workerd; keep their types local instead of replacing Node's globals.
type D1Database = Cloudflare.D1Database;
type DurableObjectNamespace<T extends Cloudflare.Rpc.DurableObjectBranded | undefined = undefined> =
  Cloudflare.DurableObjectNamespace<T>;
type Queue<T> = Cloudflare.Queue<T>;
type Request = Cloudflare.Request;
type Response = Cloudflare.Response;
type WebSocket = Cloudflare.WebSocket;
declare const Response: typeof Cloudflare.Response;
declare const WebSocketPair: typeof Cloudflare.WebSocketPair;
declare const WebSocket: typeof Cloudflare.WebSocket;

const decodeEvidence = Schema.decodeUnknownSync(BriefingEvidenceSchema, { errors: 'all' });

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
  /** Present only while the job is queued or running; discarded by every terminal commit. */
  packet?: BriefingEvidence;
  leaseUntil?: number;
  fence?: number;
  reason?: BriefingUnavailableReason;
};

export type BriefingEnv = {
  readonly BRIEFING_JOBS: DurableObjectNamespace<BriefingJob>;
  readonly BRIEFING_QUEUE: Queue<BriefingJobMessage>;
  readonly BRIEFINGS_DB: D1Database;
  readonly BRIEFING_PUBLIC_URL: string;
  readonly BRIEFING_ALLOWED_ORIGIN: string;
  readonly AI_BRIEFING_ENDPOINT?: string;
  readonly AI_BRIEFING_API_KEY?: string;
  readonly AI_BRIEFING_MODEL?: string;
};

/** 75-second provider deadline plus a 15-second persistence margin. Neither constant may shrink to speed a test. */
const LEASE_MS = 90_000;
const DISPATCH_RECOVERY_MS = 30_000;
const MAX_DISPATCH_ATTEMPTS = 3;
const JOB_KEY = 'job';
/** `#claimRunning` returns this when another owner (or no queued generation) holds the job: the caller must not run. */
const NOT_CLAIMED = 0;
/** The close a settled subscriber sees: a normal closure whose reason says the stream ended, not that it broke. */
const SOCKET_COMPLETE = 1000;
const SOCKET_COMPLETE_REASON = 'briefing complete';
/** The close for a socket this object accepted but could not serve, so a client does not wait on a silent stream. */
const SOCKET_FAILURE = 1011;
const SOCKET_FAILURE_REASON = 'briefing unavailable';
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' };

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

type TerminalOutcome =
  | { readonly state: 'available'; readonly briefing: AvailablePackageBriefing }
  | { readonly state: 'unavailable'; readonly reason: BriefingUnavailableReason };

/**
 * One D1 read, three policies: `run` continues only on a miss, `submit` rejects on failure, and `reconciledSnapshot`
 * refuses to destroy state on a transient failure. Keeping the outcomes apart here stops those policies from
 * collapsing into one.
 */
type StoredLookup =
  | { readonly outcome: 'found'; readonly briefing: AvailablePackageBriefing }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'failed' };

/** One dispatch attempt's durable bookkeeping, decided under the job lock and sent after it is released. */
type DispatchPlan =
  | { readonly action: 'skip' }
  | { readonly action: 'exhausted' }
  | { readonly action: 'send'; readonly hash: string; readonly generationId: number; readonly attempts: number };

export class BriefingJob extends DurableObject<BriefingEnv> {
  /**
   * Serialises only the decision sections — accepting a submission, claiming the lease, committing a terminal state.
   * Durable Objects interleave every `await`, so without this a simultaneous second submit would enqueue a second
   * message and an expired owner could overwrite a settled job. The provider call deliberately stays outside it.
   */
  #lock: Promise<void> = Promise.resolve();

  async #synchronized<T>(section: () => Promise<T>): Promise<T> {
    const previous = this.#lock;
    const current = Promise.withResolvers<void>();
    this.#lock = current.promise;
    await previous;
    try {
      return await section();
    } finally {
      current.resolve();
    }
  }

  /** The Queue consumer's entry point: one delivery, one generation. */
  async run(message: BriefingJobMessage): Promise<BriefingJobEvent> {
    const record = await this.#readRecord();
    if (
      record === undefined ||
      record.hash !== message.hash ||
      record.generationId !== message.generationId ||
      record.state !== 'queued'
    ) {
      // A duplicate delivery, a stale generation, or an already-settled job: the owner commits, not this message.
      return await this.reconciledSnapshot();
    }

    // D1 first. A hit is the authority and costs nothing; a read failure must never reach the provider.
    const stored = await this.#lookupStored(message.hash);
    if (stored.outcome === 'failed') return await this.#commitUnavailable('cache-error');
    if (stored.outcome === 'found') return await this.#commitAvailable(stored.briefing);

    const packet = record.packet;
    if (packet === undefined) return await this.#commitUnavailable('cache-error');

    const config = readBriefingConfig(this.env);
    if (config.status !== 'configured') return await this.#commitUnavailable(config.status);

    const lease = await this.#claimRunning(message.generationId, Date.now() + LEASE_MS);
    if (lease === NOT_CLAIMED) return await this.reconciledSnapshot();

    const generated = await Effect.runPromise(
      generateBriefing(packet, config.value).pipe(Effect.provide(FetchHttpClient.layer)),
    );
    return await this.#commitIfCurrent(lease, generated);
  }

  /**
   * A browser's read-only subscription. The public route already checked the method, the path, and the Origin; this
   * object only has to refuse anything that is not an upgrade, refuse a hash it owns no job for, and hand the socket
   * to the runtime. Accepting through `ctx.acceptWebSocket` is what keeps the socket deliverable after this object is
   * evicted — `server.accept()` and `addEventListener` would both defeat hibernation.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426, headers: TEXT_HEADERS });
    }
    if ((await this.#readRecord()) === undefined) {
      return new Response('Not Found', { status: 404, headers: TEXT_HEADERS });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    try {
      await this.#synchronized(async () => {
        // Reconciled, not remembered: a result D1 already holds is what the browser must see, and the lock keeps this
        // snapshot from landing after the terminal frame another section may be committing for the same job.
        this.#sendFrame(server, await this.#currentEvent());
      });
    } catch (error) {
      // A read failure leaves nothing to send; closing is the only honest answer to a subscriber.
      server.close(SOCKET_FAILURE, SOCKET_FAILURE_REASON);
      throw error;
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Frames from a subscriber are deliberately inert. A subscription reads this job and nothing else: no message may
   * create, retry, advance, or enqueue work, so there is no command to implement and no reply to send.
   */
  async webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Nothing a subscriber sends can change this job.
  }

  /** The runtime completes the close handshake itself; this object keeps no in-memory socket state to clean up. */
  async webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Subscribers arrive from `ctx.getWebSockets()` when a terminal state is committed, never from a local registry.
  }

  /**
   * The single place a frame reaches a subscriber. A socket that is closing or closed is skipped, so a terminal frame
   * is delivered exactly once even when a subscriber's upgrade races the commit that settles its job, and a settled
   * subscriber is closed so its client stops waiting for another revision.
   */
  #sendFrame(socket: WebSocket, event: BriefingJobEvent): void {
    if (socket.readyState !== WebSocket.READY_STATE_OPEN) return;
    socket.send(JSON.stringify(event));
    if (event.status === 'available' || event.status === 'unavailable') {
      socket.close(SOCKET_COMPLETE, SOCKET_COMPLETE_REASON);
    }
  }

  /** The private submission path. Returns the cached result, or the queued/running job's current envelope. */
  async submit(packet: BriefingEvidence): Promise<BriefingSubmission> {
    const { evidence, hash } = this.#verifiedPacket(packet);

    // D1 is the authority for available results: a hit is returned even when the provider settings have gone away.
    const stored = await this.#lookupStored(hash);
    if (stored.outcome === 'failed') throw new BriefingSubmissionError('cache-error');
    if (stored.outcome === 'found') return this.#availableSubmission(evidence, stored.briefing);

    const config = readBriefingConfig(this.env);
    if (config.status !== 'configured') throw new BriefingSubmissionError(config.status);

    const accepted = await this.#accept(hash, evidence);
    // Only the submit that created the generation dispatches it, so a simultaneous second submit adds no message.
    if (accepted.created) await this.#dispatch();
    return this.#pendingSubmission(accepted.record, evidence);
  }

  /**
   * Decode the packet and confirm it hashes to the object the submitter addressed. The packet is bounded evidence,
   * and the addressed name is the hash the submitter derived, so a mismatch is refused rather than stored.
   */
  #verifiedPacket(packet: BriefingEvidence): { evidence: BriefingEvidence; hash: string } {
    let evidence: BriefingEvidence;
    try {
      evidence = decodeEvidence(packet);
    } catch {
      throw new BriefingSubmissionError('invalid-response');
    }
    const hash = briefingEvidenceHash(evidence);
    if (this.ctx.id.name !== hash) throw new BriefingSubmissionError('invalid-response');
    return { evidence, hash };
  }

  /**
   * The accept decision: reuse a pending generation, or store the packet and start a new one. Serialised, so two
   * simultaneous submits cannot both enqueue a message, and the packet is durable before the caller answers.
   */
  async #accept(hash: string, evidence: BriefingEvidence): Promise<{ record: JobRecord; created: boolean }> {
    return await this.#synchronized(async () => {
      const current = await this.#readRecord();
      if (current !== undefined && (current.state === 'queued' || current.state === 'running')) {
        return { record: current, created: false };
      }

      // Only a submission creates or advances a generation: a failed generation stays terminal until this runs.
      const created: JobRecord = {
        hash,
        generationId: (current?.generationId ?? 0) + 1,
        revision: (current?.revision ?? 0) + 1,
        state: 'queued',
        dispatchAttempts: 0,
        packet: evidence,
      };
      await this.ctx.storage.put(JOB_KEY, created);
      return { record: created, created: true };
    });
  }

  /** The read-only projection of this job for reconnect and recovery, reconciled against D1. */
  async reconciledSnapshot(): Promise<BriefingJobEvent> {
    return await this.#synchronized(async () => await this.#currentEvent());
  }

  /**
   * The unlocked body of `reconciledSnapshot`, for callers that already hold the job lock — including a socket
   * upgrade, whose snapshot must not overtake a terminal frame being committed for the same job.
   */
  async #currentEvent(): Promise<BriefingJobEvent> {
    const record = await this.#readRecord();
    if (record === undefined) throw new Error('No briefing job for this evidence hash');
    if (record.state === 'queued' || record.state === 'running') {
      return { status: record.state, revision: record.revision };
    }
    if (record.state === 'unavailable') return this.#unavailableEvent(record);

    // Available: the D1 row is the result, so a transient read failure must not destroy the job's state.
    const stored = await this.#lookupStored(record.hash);
    if (stored.outcome === 'failed') throw new Error('Briefing store is unavailable');
    if (stored.outcome === 'missing') {
      // Under the lock already, so the terminal path is entered directly rather than through `#commitTerminal`.
      return await this.#commitTerminalLocked({ state: 'unavailable', reason: 'cache-error' });
    }
    return { status: 'available', revision: record.revision, briefing: stored.briefing };
  }

  /** The dispatch-recovery alarm: redeliver a queued job, or settle a generation whose lease ran out. */
  async alarm(): Promise<void> {
    const record = await this.#readRecord();
    if (record === undefined || record.state === 'available' || record.state === 'unavailable') return;
    if (record.state === 'queued') {
      await this.#dispatch();
      return;
    }
    await this.#settleExpiredLease(record);
  }

  /**
   * A running generation whose lease ran out was never completed: reconcile D1 first, because a crash after the row
   * was written is a finished job. No branch buys a second paid call, and the three lookup outcomes keep three
   * different meanings: a stored result is a finished job, a missing row means the generation was lost with nothing
   * durable, and a read failure is a storage outage — never reported as a timeout.
   */
  async #settleExpiredLease(record: JobRecord): Promise<void> {
    const expiresAt = record.leaseUntil ?? 0;
    if (Date.now() < expiresAt) {
      // Another owner may still be generating; the lease, not this alarm, decides when it is dead.
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }

    const stored = await this.#lookupStored(record.hash);
    switch (stored.outcome) {
      case 'found':
        await this.#commitAvailable(stored.briefing);
        return;
      case 'missing':
        await this.#commitUnavailable('timeout');
        return;
      case 'failed':
        await this.#commitUnavailable('cache-error');
        return;
    }
  }

  async #commitAvailable(value: AvailablePackageBriefing): Promise<BriefingJobEvent> {
    return await this.#commitTerminal({ state: 'available', briefing: value });
  }

  async #commitUnavailable(reason: BriefingUnavailableReason): Promise<BriefingJobEvent> {
    return await this.#commitTerminal({ state: 'unavailable', reason });
  }

  /**
   * Claim the running lease for this generation. Returns the fencing token, or `NOT_CLAIMED` when the job is no
   * longer queued for that generation.
   */
  async #claimRunning(generationId: number, expiresAt: number): Promise<number> {
    return await this.#synchronized(async () => {
      const record = await this.#readRecord();
      if (record === undefined || record.state !== 'queued' || record.generationId !== generationId) {
        return NOT_CLAIMED;
      }
      const fence = (record.fence ?? 0) + 1;
      await this.ctx.storage.put(JOB_KEY, {
        ...record,
        state: 'running',
        fence,
        leaseUntil: expiresAt,
        revision: record.revision + 1,
      });
      // The lease alarm is set while claiming, so a crash mid-generation is always reconciled.
      await this.ctx.storage.setAlarm(expiresAt);
      return fence;
    });
  }

  /** Commit a generated result only while this owner still holds the lease; a stale owner just reports the job. */
  async #commitIfCurrent(lease: number, result: PackageBriefing): Promise<BriefingJobEvent> {
    const record = await this.#readRecord();
    if (record === undefined || record.state !== 'running' || record.fence !== lease) {
      return await this.reconciledSnapshot();
    }
    if (result.status === 'unavailable') return await this.#commitUnavailable(result.reason);

    // The row is written and read back before any terminal event is committed: a refused write is never success.
    let stored: AvailablePackageBriefing;
    try {
      stored = await saveBriefing(this.env.BRIEFINGS_DB, record.hash, result);
    } catch (cause) {
      if (!isBriefingStoreFailure(cause)) throw cause;
      return await this.#commitUnavailable('cache-error');
    }
    return await this.#commitAvailable(stored);
  }

  /** The single terminal path, entered under the job lock. */
  async #commitTerminal(outcome: TerminalOutcome): Promise<BriefingJobEvent> {
    return await this.#synchronized(async () => await this.#commitTerminalLocked(outcome));
  }

  /**
   * First writer wins, the packet is dropped, the recovery alarm is cleared, and every subscriber is sent this
   * terminal frame and closed. Called with the job lock held, so no subscriber's own snapshot can land after it.
   */
  async #commitTerminalLocked(outcome: TerminalOutcome): Promise<BriefingJobEvent> {
    const record = await this.#readRecord();
    if (record === undefined) throw new Error(`No briefing job to settle as ${outcome.state}`);
    if (record.state === 'available' || record.state === 'unavailable') return await this.#terminalEvent(record);

    const settled: JobRecord = {
      hash: record.hash,
      generationId: record.generationId,
      revision: record.revision + 1,
      state: outcome.state,
      dispatchAttempts: record.dispatchAttempts,
      ...(record.fence === undefined ? {} : { fence: record.fence }),
      ...(outcome.state === 'unavailable' ? { reason: outcome.reason } : {}),
    };
    await this.ctx.storage.put(JOB_KEY, settled);
    await this.ctx.storage.deleteAlarm();

    const event: BriefingJobEvent =
      outcome.state === 'available'
        ? { status: 'available', revision: settled.revision, briefing: outcome.briefing }
        : this.#unavailableEvent(settled);
    for (const socket of this.ctx.getWebSockets()) this.#sendFrame(socket, event);
    return event;
  }

  /**
   * Record one dispatch attempt and arm the recovery alarm before the message is sent, so a Queue outage is retried
   * by the alarm rather than leaving the job queued forever. Terminal after `MAX_DISPATCH_ATTEMPTS`.
   */
  async #dispatch(): Promise<void> {
    const plan = await this.#synchronized(async (): Promise<DispatchPlan> => {
      const record = await this.#readRecord();
      if (record === undefined || record.state !== 'queued') return { action: 'skip' };
      const attempts = record.dispatchAttempts + 1;
      if (attempts > MAX_DISPATCH_ATTEMPTS) return { action: 'exhausted' };

      // A dispatch attempt is internal bookkeeping, not a client-visible transition, so the revision does not move.
      await this.ctx.storage.put(JOB_KEY, { ...record, dispatchAttempts: attempts });
      await this.ctx.storage.setAlarm(Date.now() + DISPATCH_RECOVERY_MS);
      return { action: 'send', hash: record.hash, generationId: record.generationId, attempts };
    });

    if (plan.action === 'skip') return;
    if (plan.action === 'exhausted') {
      await this.#commitUnavailable('provider-error');
      return;
    }

    try {
      await this.env.BRIEFING_QUEUE.send({ hash: plan.hash, generationId: plan.generationId });
    } catch {
      // The message was never accepted. The alarm redelivers, and the last attempt settles the job as failed.
      if (plan.attempts >= MAX_DISPATCH_ATTEMPTS) await this.#commitUnavailable('provider-error');
    }
  }

  async #readRecord(): Promise<JobRecord | undefined> {
    return await this.ctx.storage.get<JobRecord>(JOB_KEY);
  }

  async #lookupStored(hash: string): Promise<StoredLookup> {
    try {
      const briefing = await readStoredBriefing(this.env.BRIEFINGS_DB, hash);
      return briefing === undefined ? { outcome: 'missing' } : { outcome: 'found', briefing };
    } catch (cause) {
      if (!isBriefingStoreFailure(cause)) throw cause;
      return { outcome: 'failed' };
    }
  }

  async #terminalEvent(record: JobRecord): Promise<BriefingJobEvent> {
    if (record.state === 'unavailable') return this.#unavailableEvent(record);
    const stored = await this.#lookupStored(record.hash);
    if (stored.outcome !== 'found') throw new Error('The stored briefing for this job disappeared');
    return { status: 'available', revision: record.revision, briefing: stored.briefing };
  }

  #unavailableEvent(record: JobRecord): BriefingJobEvent {
    return { status: 'unavailable', revision: record.revision, reason: record.reason ?? 'cache-error' };
  }

  #eventsUrl(hash: string): string {
    return `${this.env.BRIEFING_PUBLIC_URL.replace(/\/+$/, '')}/api/briefings/${hash}/events`;
  }

  #pendingSubmission(record: JobRecord, evidence: BriefingEvidence): BriefingSubmission {
    return {
      status: record.state === 'running' ? 'running' : 'queued',
      packageName: evidence.packageName,
      from: evidence.from,
      to: evidence.to,
      hash: record.hash,
      eventsUrl: this.#eventsUrl(record.hash),
      revision: record.revision,
    };
  }

  #availableSubmission(evidence: BriefingEvidence, briefing: AvailablePackageBriefing): BriefingSubmission {
    return {
      status: 'available',
      packageName: evidence.packageName,
      from: evidence.from,
      to: evidence.to,
      briefing,
    };
  }
}
