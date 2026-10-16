import type * as Cloudflare from '@cloudflare/workers-types';

import type { BriefingJobEvent } from '../../shared/comparison/briefing/briefingJob.defs';
import { telemetryDecimal } from '../../shared/telemetry/telemetryFields';
import { JOB_KEY, type BriefingJobMessage, type JobRecord } from './jobState';
import { flowCorrelation } from './jobTrace';
import type { BriefingFlowCorrelation, BriefingFlowFields, BriefingTrigger } from './jobTrace';

export const DISPATCH_RECOVERY_MS = 30_000;

const MAX_DISPATCH_ATTEMPTS = 3;

/** The job keeps the lock and terminal writer; dispatch owns only durable attempt bookkeeping and Queue sending. */
export type BriefingDispatchOwner = {
  readonly storage: Pick<Cloudflare.DurableObjectStorage, 'put' | 'setAlarm'>;
  readonly queue: Cloudflare.Queue<BriefingJobMessage>;
  readonly read: () => Promise<JobRecord | undefined>;
  readonly locked: <A>(section: () => Promise<A>) => Promise<A>;
  readonly settle: () => Promise<BriefingJobEvent>;
  readonly emit: (fields: BriefingFlowFields) => void;
};

type SendPlan = {
  readonly action: 'send';
  readonly hash: string;
  readonly generationId: number;
  readonly attempts: number;
  readonly flow: BriefingFlowCorrelation;
};

type DispatchPlan = { readonly action: 'skip' } | { readonly action: 'exhausted' } | SendPlan;

/** Persist attempts and arm recovery under the existing job lock, then send outside it. */
export const dispatchBriefingJob = async (owner: BriefingDispatchOwner, trigger: BriefingTrigger): Promise<void> => {
  const plan = await owner.locked(() => planDispatch(owner, trigger));

  if (plan.action === 'skip') return;

  if (plan.action === 'exhausted') {
    await owner.settle();

    return;
  }

  await sendDispatch(owner, plan, trigger);
};

/** Decide under the lock whether this trigger sends, recording the attempt and arming recovery before any send. */
const planDispatch = async (owner: BriefingDispatchOwner, trigger: BriefingTrigger): Promise<DispatchPlan> => {
  const record = await owner.read();
  const flow = flowCorrelation(record);

  if (record === undefined || record.state !== 'queued') {
    owner.emit({ ...flow, operation: 'dispatch', trigger, outcome: 'ignored' });

    return { action: 'skip' };
  }

  const attempts = record.dispatchAttempts + 1;

  if (attempts > MAX_DISPATCH_ATTEMPTS) {
    owner.emit({
      ...flow,
      operation: 'dispatch',
      trigger,
      outcome: 'exhausted',
      attempt: telemetryDecimal(attempts),
      reason: 'dispatch-exhausted',
    });

    return { action: 'exhausted' };
  }

  // Attempt bookkeeping never advances the browser-visible revision.
  await owner.storage.put(JOB_KEY, { ...record, dispatchAttempts: attempts });
  await owner.storage.setAlarm(Date.now() + DISPATCH_RECOVERY_MS);

  return { action: 'send', hash: record.hash, generationId: record.generationId, attempts, flow };
};

/** Outside the lock: a refused send is a retry, and the last refused attempt exhausts the job. */
const sendDispatch = async (owner: BriefingDispatchOwner, plan: SendPlan, trigger: BriefingTrigger): Promise<void> => {
  try {
    await owner.queue.send({ hash: plan.hash, generationId: plan.generationId });
    owner.emit({
      ...plan.flow,
      operation: 'dispatch',
      trigger,
      outcome: 'sent',
      attempt: telemetryDecimal(plan.attempts),
    });
  } catch {
    const last = plan.attempts >= MAX_DISPATCH_ATTEMPTS;
    owner.emit({
      ...plan.flow,
      operation: 'dispatch',
      trigger,
      outcome: last ? 'exhausted' : 'retry',
      attempt: telemetryDecimal(plan.attempts),
      reason: 'transport',
    });

    if (last) await owner.settle();
  }
};
