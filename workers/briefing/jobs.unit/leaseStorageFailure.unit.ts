// Integration test for the briefing job Worker's lease reconciliation under a storage outage: when the crashed
// generation's D1 row cannot be read back at all, the real 90-second lease alarm must report cache-error rather than a
// timeout. The wait is the production lease, not a shortened test value, so this suite lives in its own file beside
// the other job suites and runs in parallel with them.

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
  it('reports a storage outage at lease reconciliation as cache-error rather than a timeout', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('crash-outage-fixture', '18.0.0', '18.1.0');

    const hash = await crashRunningGeneration(stateDir, packet);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    const resumed = await startRuntime({ stateDir, installSchema: false });

    try {
      expect((await resumed.jobEvent(hash))?.status).toBe('running');
      // The real D1 fault: the crashed generation's row cannot be read back at all.
      await resumed.database.prepare('DROP TABLE package_briefings').run();

      const settled = await waitForJobEvent(resumed, hash, (event) => event.status === 'unavailable', LEASE_WAIT_MS);
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'cache-error' });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await resumed.dispose();
    }
  }, 300_000);
});
