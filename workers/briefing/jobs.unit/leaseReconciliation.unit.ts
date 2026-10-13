// A generation that crashed after writing its D1 row must reconcile from that row without buying another paid call.
// The test-only clock advances to the persisted production lease deadline; workerd delivers the real alarm handler.
// leaseExpiry.unit.ts retains the wall-clock lease guard, including native scheduling after a process restart.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing } from '#shared/comparison/briefing/briefing.defs';

import { readStoredBriefing, saveBriefing } from '../../../server/comparison/briefing/store';
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
  it('reconciles a crashed generation from the result it had already stored, without paying a second time', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('crash-stored-fixture', '17.0.0', '17.1.0');

    const hash = await crashRunningGeneration(stateDir, packet);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    // The canonical briefing the crashed generation wrote to D1 before it lost its process, through the production
    // store and the real binding. Its model name and bullet are only reachable if reconciliation reads this row.
    const recovered: AvailablePackageBriefing = {
      status: 'available',
      model: 'recovered-fixture-model',
      bullets: [
        {
          kind: 'migration',
          basis: 'inference',
          text: 'The durable row this hash already owns is the authority after a crash.',
          evidenceNumbers: [0],
        },
      ],
      sources: packet.sources.map((source, position) => ({ ...source, number: position })),
    };

    const resumed = await startRuntime({ stateDir, installSchema: false, controlledTime: true });

    try {
      // The crashed generation never committed, so the row can only come from this write.
      expect(await readStoredBriefing(resumed.database, hash)).toBeUndefined();
      expect(await saveBriefing(resumed.database, hash, recovered)).toEqual(recovered);

      // The job is still the crashed generation's; only its lease running out may settle it.
      const running = await waitForJobEvent(resumed, hash, (event) => event.status === 'running');

      await resumed.fireNextAlarm(hash);
      const settled = await waitForJobEvent(resumed, hash, (event) => event.status === 'available');
      expect(settled).toMatchObject({ status: 'available', briefing: recovered });
      expect(settled.revision).toBeGreaterThan(running.revision);

      // The row is untouched and the fixture's counter proves reconciliation bought no second paid call.
      expect(await readStoredBriefing(resumed.database, hash)).toEqual(recovered);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await resumed.dispose();
    }
  }, 300_000);
});
