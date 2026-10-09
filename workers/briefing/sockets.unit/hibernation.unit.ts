// Integration tests for the briefing Worker's hibernating subscribers: sockets accepted through the public route stay
// deliverable across frames, disconnects and process restarts, and client-side frames never buy work. Every case runs
// the real runtime and the real hibernating WebSocket API inside the SQLite-backed Durable Object; nothing here
// fabricates frames in process. The upgrade/allow-list cases and the eviction case live in the sibling suites of this
// directory so they can run in parallel with this file.

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing } from '#shared/comparison/briefing/briefing.defs';

import { briefingEvidenceHash } from '../../../server/comparison/briefing/generation';
import { readStoredBriefing } from '../../../server/comparison/briefing/store';
import { FIXTURE_API_KEY, MODEL, providerFixture, startProviderFixture } from '../test/provider.stub';
import {
  CLOSE,
  JOB_WAIT_MS,
  QUIET_MS,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  subscribe,
  waitFor,
  waitForJobEvent,
  waitForStoredBriefing,
} from '../test/worker.harness';

beforeAll(async () => {
  await startProviderFixture();
}, 30_000);

afterAll(async () => {
  await providerFixture().close();
  await removeStateDirs();
});

describe('hibernating subscribers', () => {
  it('sends a pending snapshot, then exactly one canonical available frame, then the close', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-pending', '2.0.0', '2.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      expect(subscription.events()).toEqual([{ status: 'running', revision: running.revision }]);

      provider.releaseStalls();
      const stored = await waitForStoredBriefing(runtime.database, hash);
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'available');

      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(settled.revision).toBeGreaterThan(running.revision);
      expect(subscription.events()).toEqual([
        { status: 'running', revision: running.revision },
        { status: 'available', revision: settled.revision, briefing: stored },
      ]);
      expect(subscription.frames.join()).not.toContain(FIXTURE_API_KEY);
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);

  it('gives a subscriber that attaches after completion one canonical frame and the close', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-completed', '3.0.0', '3.1.0');
    const hash = briefingEvidenceHash(packet);
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      const stored = await waitForStoredBriefing(runtime.database, hash);
      expect(stored).toMatchObject({ status: 'available', model: MODEL });
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'available');

      const subscription = await subscribe(runtime, hash);

      expect(subscription.status).toBe(101);
      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([{ status: 'available', revision: settled.revision, briefing: stored }]);
    } finally {
      await runtime.dispose();
    }
  }, 60_000);

  it('reconnects after a real process restart from persistence alone, with no queue or provider work', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-restart', '4.0.0', '4.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();

    let durable: { revision: number; briefing: AvailablePackageBriefing } | undefined;
    const before = await startRuntime({ stateDir });
    try {
      expect((await before.submit(packet)).submission?.status).toBe('queued');
      const briefing = await waitForStoredBriefing(before.database, hash);
      const settled = await waitForJobEvent(before, hash, (event) => event.status === 'available');
      durable = { revision: settled.revision, briefing };
      // The counter observes the one paid generation before this case asks it to observe nothing.
      expect(before.queueDeliveries()).toBeGreaterThan(0);
    } finally {
      await before.dispose();
    }
    if (durable === undefined) throw new Error('The first runtime never settled this job');

    // A fresh runtime against the same persistence directory: the object that owned the job is gone.
    const after = await startRuntime({ stateDir, installSchema: false });
    try {
      expect(after.queueDeliveries()).toBe(0);
      const subscription = await subscribe(after, hash);

      expect(subscription.status).toBe(101);
      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([
        { status: 'available', revision: durable.revision, briefing: durable.briefing },
      ]);
      expect(after.queueDeliveries()).toBe(0);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await after.dispose();
    }
  }, 120_000);

  it('settles a second invalid model output as unavailable and closes every subscriber', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-invalid-output', '6.0.0', '6.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');

      const first = await subscribe(runtime, hash);
      const second = await subscribe(runtime, hash);
      expect([first.status, second.status]).toEqual([101, 101]);
      expect(first.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(second.events()).toEqual([{ status: 'running', revision: running.revision }]);

      // The held request is released into the invalid mode, so the generator's one retry is invalid as well.
      provider.setMode({ kind: 'invalid' });
      provider.releaseStalls();

      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable');
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
      expect(provider.requestsFor(packet.packageName)).toBe(2);

      await expect(first.closed).resolves.toEqual(CLOSE);
      await expect(second.closed).resolves.toEqual(CLOSE);
      expect(settled.revision).toBeGreaterThan(running.revision);
      expect(first.events()).toEqual([
        { status: 'running', revision: running.revision },
        { status: 'unavailable', revision: settled.revision, reason: 'invalid-response' },
      ]);
      expect(second.events()).toEqual(first.events());
      expect(await readStoredBriefing(runtime.database, hash)).toBeUndefined();
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);

  it('creates no queue or provider work from client frames or from a reconnect', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-quiet', '7.0.0', '7.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');
      // A delivery is only logged when the broker's flush returns, and this job's generation is still stalled. The
      // counter therefore starts at zero here and the case proves it observes a real delivery at the end.
      const deliveries = runtime.queueDeliveries();

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      subscription.send('junk');
      subscription.send(JSON.stringify({ status: 'retry', hash, generationId: 1 }));
      subscription.send(JSON.stringify({ action: 'resubmit', revision: running.revision, packet }));
      subscription.send('');

      await delay(QUIET_MS);
      expect(subscription.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(runtime.queueDeliveries()).toBe(deliveries);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(await runtime.jobEvent(hash)).toEqual({ status: 'running', revision: running.revision });

      subscription.close();
      const reconnected = await subscribe(runtime, hash);
      await delay(QUIET_MS);

      expect(reconnected.status).toBe(101);
      expect(reconnected.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(runtime.queueDeliveries()).toBe(deliveries);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(await runtime.jobEvent(hash)).toEqual({ status: 'running', revision: running.revision });

      // Positive control for the counter this case just held constant: releasing the stalled generation lets its own
      // queue message finish, which is the one delivery this runtime logs.
      provider.releaseStalls();
      await waitForStoredBriefing(runtime.database, hash);
      await waitFor(
        async () => (runtime.queueDeliveries() > deliveries ? true : undefined),
        JOB_WAIT_MS,
        'the queue delivery line for the stalled generation',
      );
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);
});
