// Integration test for the briefing job Worker's lease reconciliation: a generation that crashed after writing its D1
// row must settle as available from that row once the real 90-second lease alarm fires, without buying a second paid
// call. The wait is the production lease, not a shortened test value, so this suite lives in its own file beside the
// other job suites and runs in parallel with them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing } from '#shared/briefing.defs';

import { readStoredBriefing, saveBriefing } from '../../../server/utils/packageBriefingStore';
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

    const resumed = await startRuntime({ stateDir });
    try {
      // The crashed generation never committed, so the row can only come from this write.
      expect(await readStoredBriefing(resumed.database, hash)).toBeUndefined();
      expect(await saveBriefing(resumed.database, hash, recovered)).toEqual(recovered);

      // The job is still the crashed generation's; only its lease running out may settle it.
      const running = await waitForJobEvent(resumed, hash, (event) => event.status === 'running');

      const settled = await waitForJobEvent(resumed, hash, (event) => event.status === 'available', LEASE_WAIT_MS);
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
