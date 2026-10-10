// Integration test for the briefing Worker's socket surface under a real object eviction: an accepted subscriber must
// outlive the Durable Object that accepted it, receive the terminal frame from the job's own recovery alarm (two
// 30-second dispatch attempts, no Queue), and see the canonical close. The case spans ~60s of real alarms, so it
// lives in its own file beside the other socket suites and runs in parallel with them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { briefingEvidenceHash } from '../../../server/comparison/briefing/generation';
import { readStoredBriefing } from '../../../server/comparison/briefing/store';
import { providerFixture, startProviderFixture } from '../test/provider.stub';
import {
  CLOSE,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  subscribe,
  waitForJobEvent,
} from '../test/worker.harness';

beforeAll(async () => {
  await startProviderFixture();
}, 30_000);

afterAll(async () => {
  await providerFixture().close();
  await removeStateDirs();
});

describe('hibernating subscribers', () => {
  it('delivers the terminal frame to a subscriber that survives a real object eviction', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-evicted', '5.0.0', '5.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    // This runtime has no Queue producer, so only the job's own dispatch-recovery alarm can settle it — the durable
    // path a subscriber has to be reachable from after the object that accepted it was evicted.
    const runtime = await startRuntime({ stateDir, producer: false, consumer: false });

    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      const queued = await waitForJobEvent(runtime, hash, (event) => event.status === 'queued');

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      expect(subscription.events()).toEqual([{ status: 'queued', revision: queued.revision }]);

      // Real eviction, hibernating the accepted socket: the object is gone, and what wakes it next is its alarm.
      await runtime.evictJob(hash);

      // Two further dispatch attempts, thirty seconds apart, are what make this job terminal — so the frame below
      // reaches a socket that outlived the object which accepted it.
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable', 120_000);
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'provider-error' });
      expect(settled.revision).toBeGreaterThan(queued.revision);

      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([
        { status: 'queued', revision: queued.revision },
        { status: 'unavailable', revision: settled.revision, reason: 'provider-error' },
      ]);
      // No dispatch ever reached a Queue, so nothing paid for a generation the browser was not waiting on.
      expect(provider.requestsFor(packet.packageName)).toBe(0);
      expect(await readStoredBriefing(runtime.database, hash)).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  }, 240_000);
});
