import type * as Cloudflare from '@cloudflare/workers-types';

import type { BriefingUnavailableReason } from '../../shared/comparison/briefing/briefing.defs';
import type { BriefingJobEvent } from '../../shared/comparison/briefing/briefingJob.defs';
import { JOB_KEY, type BriefingJobMessage, type JobRecord } from './jobState';

const DISPATCH_RECOVERY_MS = 30_000;

const MAX_DISPATCH_ATTEMPTS = 3;

/**
 * What dispatch needs from its job object. The job keeps the lock and the terminal writer; dispatch owns only the
 * durable attempt bookkeeping and the Queue send, so it cannot commit state except through `commitUnavailable`.
 */
export type BriefingDispatchOwner = {
  readonly storage: Pick<Cloudflare.DurableObjectStorage, 'put' | 'setAlarm'>;
  readonly queue: Cloudflare.Queue<BriefingJobMessage>;
  readonly read: () => Promise<JobRecord | undefined>;
  readonly locked: <A>(section: () => Promise<A>) => Promise<A>;
  readonly commitUnavailable: (reason: BriefingUnavailableReason) => Promise<BriefingJobEvent>;
};

/** One dispatch attempt's durable bookkeeping, decided under the job lock and sent after it is released. */
type DispatchPlan =
  | { readonly action: 'skip' }
  | { readonly action: 'exhausted' }
  | { readonly action: 'send'; readonly hash: string; readonly generationId: number; readonly attempts: number };

/**
 * Record one dispatch attempt and arm the recovery alarm before the message is sent, so a Queue outage is retried
 * by the alarm rather than leaving the job queued forever. Terminal after `MAX_DISPATCH_ATTEMPTS`.
 */
export const dispatchBriefingJob = async (owner: BriefingDispatchOwner): Promise<void> => {
  const plan = await owner.locked(async (): Promise<DispatchPlan> => {
    const record = await owner.read();

    if (record === undefined || record.state !== 'queued') return { action: 'skip' };
    const attempts = record.dispatchAttempts + 1;

    if (attempts > MAX_DISPATCH_ATTEMPTS) return { action: 'exhausted' };

    // A dispatch attempt is internal bookkeeping, not a client-visible transition, so the revision does not move.
    await owner.storage.put(JOB_KEY, { ...record, dispatchAttempts: attempts });
    await owner.storage.setAlarm(Date.now() + DISPATCH_RECOVERY_MS);

    return { action: 'send', hash: record.hash, generationId: record.generationId, attempts };
  });

  if (plan.action === 'skip') return;

  if (plan.action === 'exhausted') {
    await owner.commitUnavailable('provider-error');

    return;
  }

  try {
    await owner.queue.send({ hash: plan.hash, generationId: plan.generationId });
  } catch {
    // The message was never accepted. The alarm redelivers, and the last attempt settles the job as failed.
    if (plan.attempts >= MAX_DISPATCH_ATTEMPTS) await owner.commitUnavailable('provider-error');
  }
};
