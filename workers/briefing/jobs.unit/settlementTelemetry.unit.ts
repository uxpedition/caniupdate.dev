// Settlement telemetry for the briefing job: one `briefing.job.settled` record per won terminal commit, none for
// duplicate or stale Queue deliveries, and one for dispatch exhaustion. Assertions read the real Worker's structured
// console output alongside durable provider-call counts. Every case runs the real Worker bundle, Durable Object,
// Queue, and D1 inside one Miniflare instance; the provider is the loopback stub.

import { setTimeout as delay } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { briefingEvidenceHash } from '../../../server/comparison/briefing/generation';
import { startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import {
  JOB_WAIT_MS,
  QUIET_MS,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  waitFor,
  waitForJobEvent,
  waitForStoredBriefing,
  type RuntimeFixture,
} from '../test/worker.harness';

let provider: ProviderFixture;

const WorkerEffectLogSchema = Schema.Struct({
  message: Schema.String,
  annotations: Schema.Record(Schema.String, Schema.Unknown),
});

type WorkerEffectLog = typeof WorkerEffectLogSchema.Type;

const decodeWorkerEffectLog = Schema.decodeUnknownSync(WorkerEffectLogSchema, { errors: 'all' });

const parseWorkerEffectLog = (line: string): WorkerEffectLog | undefined => {
  try {
    return decodeWorkerEffectLog(JSON.parse(line));
  } catch {
    return undefined;
  }
};

/** Structured records for one message and one package, so concurrent cases in the same runtime cannot collide. */
const logsFor = (runtime: RuntimeFixture, message: string, packageName: string): WorkerEffectLog[] =>
  runtime.structuredLogs().flatMap((line) => {
    const record = parseWorkerEffectLog(line);

    return record?.message === message && record.annotations['comparison.package.name'] === packageName ? [record] : [];
  });

beforeAll(async () => {
  provider = await startProviderFixture();
}, 60_000);

afterAll(async () => {
  await provider.close();
  await removeStateDirs();
});

describe('briefing job settlement telemetry', () => {
  it('emits exactly one settled record for a successful terminal commit and nothing from the packet or prose', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('settlement-success-fixture', '21.0.0', '21.1.0');
    const hash = briefingEvidenceHash(packet);
    const runtime = await startRuntime({ stateDir });

    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitForStoredBriefing(runtime.database, hash);
      await waitForJobEvent(runtime, hash, (event) => event.status === 'available');
      await delay(QUIET_MS);

      const settled = logsFor(runtime, 'briefing.job.settled', packet.packageName);

      expect(settled).toHaveLength(1);
      expect(provider.requestsFor(packet.packageName)).toBe(1);

      const serialized = JSON.stringify(settled[0]);

      expect(serialized).not.toContain(hash);
      expect(serialized).not.toContain('Node >=20');
      expect(serialized).not.toContain('evidence');
    } finally {
      await runtime.dispose();
    }
  }, 120_000);

  it('does not emit a second settled record or call the provider for a duplicate Queue delivery', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('settlement-duplicate-fixture', '22.0.0', '22.1.0');
    const hash = briefingEvidenceHash(packet);
    const runtime = await startRuntime({ stateDir });

    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitForStoredBriefing(runtime.database, hash);
      await waitForJobEvent(runtime, hash, (event) => event.status === 'available');

      const acknowledged = runtime.queueAcknowledgements();
      const queue = runtime.queue;

      if (queue === undefined) throw new Error('Expected the runtime queue producer');
      await queue.send({ hash, generationId: 1 });
      await waitFor(
        async () => (runtime.queueAcknowledgements() > acknowledged ? true : undefined),
        JOB_WAIT_MS,
        'the duplicate Queue delivery acknowledgement',
      );
      await delay(QUIET_MS);

      expect(logsFor(runtime, 'briefing.job.settled', packet.packageName)).toHaveLength(1);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await runtime.dispose();
    }
  }, 120_000);

  it('does not claim settlement when terminal storage refuses the write, and requests Queue retry', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('settlement-put-failure-fixture', '24.0.0', '24.1.0');
    const hash = briefingEvidenceHash(packet);
    const runtime = await startRuntime({ stateDir, terminalPutFailure: true });

    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitForStoredBriefing(runtime.database, hash);

      const recovery = await waitFor(
        async () =>
          logsFor(runtime, 'briefing.job.recovery', packet.packageName).find(
            (record) => record.annotations.reason === 'storage-write',
          ),
        JOB_WAIT_MS,
        'the refused terminal put diagnostic',
      );

      await waitFor(
        async () =>
          runtime
            .structuredLogs()
            .map(parseWorkerEffectLog)
            .find(
              (record) =>
                record?.message === 'briefing.queue.decision' &&
                record.annotations.outcome === 'retry' &&
                record.annotations.reason === 'unexpected',
            ),
        JOB_WAIT_MS,
        'the real Queue retry decision after the refused write',
      );

      expect(recovery.annotations).toMatchObject({ outcome: 'failure', settlement: 'storage-failure' });
      expect(await runtime.jobEvent(hash)).toMatchObject({ status: 'running' });
      expect(logsFor(runtime, 'briefing.job.settled', packet.packageName)).toEqual([]);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(JSON.stringify(runtime.structuredLogs())).not.toContain('PRIVATE_TERMINAL_PUT_MARKER');
    } finally {
      await runtime.dispose();
    }
  }, 120_000);
  it('emits one settled record for dispatch exhaustion and no provider call', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('settlement-exhaustion-fixture', '23.0.0', '23.1.0');
    const hash = briefingEvidenceHash(packet);
    const parked = await startRuntime({ stateDir, producer: false, consumer: false, controlledTime: true });

    try {
      expect((await parked.submit(packet)).submission?.status).toBe('queued');
      await parked.jobEvent(hash);
      await parked.fireNextAlarm(hash);
      await parked.fireNextAlarm(hash);
      await waitForJobEvent(parked, hash, (event) => event.status === 'unavailable');
      await delay(QUIET_MS);

      const settled = logsFor(parked, 'briefing.job.settled', packet.packageName);

      expect(settled).toHaveLength(1);
      expect(settled[0]?.annotations).toMatchObject({
        outcome: 'unavailable',
        settlement: 'dispatch-exhausted',
        reason: 'provider-error',
      });
      expect(provider.requestsFor(packet.packageName)).toBe(0);
    } finally {
      await parked.dispose();
    }
  }, 180_000);
});
