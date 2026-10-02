// Integration test for the briefing job Worker's lease expiry: a generation killed mid-flight still owns the lease,
// so a new POST must join it rather than pay for a second call, and only the lease running out (a real 90-second DO
// alarm) may settle the job as timed out before a later POST starts over. The wait is the production lease, not a
// shortened test value, so this suite lives in its own file beside the other job suites and runs in parallel with
// them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import {
  LEASE_WAIT_MS,
  crashRunningGeneration,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  waitForJobEvent,
  waitForStoredBriefing,
} from '../test/worker.harness';

let provider: ProviderFixture;

beforeAll(async () => {
  provider = await startProviderFixture();
}, 30_000);

afterAll(async () => {
  await provider.close();
  await removeStateDirs();
});

describe('briefing job Worker', () => {
  it('expires a crashed generation instead of paying twice, and a later POST starts over', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('crash-fixture', '16.0.0', '16.1.0');

    const hash = await crashRunningGeneration(stateDir, packet);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    const resumed = await startRuntime({ stateDir });
    try {
      // The crashed generation still owns the lease: a new POST must not start a second paid call.
      const during = await resumed.submit(packet);
      expect(during.submission?.status).toBe('running');
      expect(provider.requestsFor(packet.packageName)).toBe(1);

      const expired = await waitForJobEvent(resumed, hash, (event) => event.status === 'unavailable', LEASE_WAIT_MS);
      expect(expired).toMatchObject({ status: 'unavailable', reason: 'timeout' });
      expect(provider.requestsFor(packet.packageName)).toBe(1);

      expect((await resumed.submit(packet)).submission?.status).toMatch(/queued|running/);
      const stored = await waitForStoredBriefing(resumed.database, hash);
      const completed = await waitForJobEvent(resumed, hash, (event) => event.status === 'available');
      expect(completed.revision).toBeGreaterThan(expired.revision);
      expect(provider.requestsFor(packet.packageName)).toBe(2);
      expect(completed).toMatchObject({ status: 'available', briefing: stored });
    } finally {
      await resumed.dispose();
    }
  }, 300_000);
});
