// When the crashed generation's D1 row cannot be read, lease reconciliation reports cache-error, not a timeout.
// The test-only clock advances to the persisted production lease deadline; workerd delivers the real alarm handler.
// leaseExpiry.unit.ts retains the wall-clock lease guard, including native scheduling after a process restart.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import {
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

    const resumed = await startRuntime({ stateDir, installSchema: false, controlledTime: true });

    try {
      expect((await resumed.jobEvent(hash))?.status).toBe('running');
      // The real D1 fault: the crashed generation's row cannot be read back at all.
      await resumed.database.prepare('DROP TABLE package_briefings').run();

      await resumed.fireNextAlarm(hash);
      const settled = await waitForJobEvent(resumed, hash, (event) => event.status === 'unavailable');
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'cache-error' });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await resumed.dispose();
    }
  }, 300_000);
});
