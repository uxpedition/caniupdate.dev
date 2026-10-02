// Integration tests for the briefing job Worker's dispatch-recovery path: a job that must be recovered by its own
// 30-second alarm rather than by the Queue, and a job whose D1 read stays broken until its lease resolution reports
// the outage. Each case spans real alarm windows (30s), so this suite lives in its own file beside the other job
// suites and runs in parallel with them.

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { briefingEvidenceHash } from '../../../server/utils/packageBriefing';
import { readStoredBriefing } from '../../../server/utils/packageBriefingStore';
import { MODEL, startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import {
  QUIET_MS,
  installBriefingSchema,
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
  it('commits a queued job unavailable when D1 stays unreadable, then starts over on a later POST', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('d1-queued-fixture', '6.0.0', '6.1.0');
    const hash = briefingEvidenceHash(packet);

    const parked = await startRuntime({ stateDir, consumer: false });
    try {
      expect((await parked.submit(packet)).submission?.status).toBe('queued');
      expect((await parked.jobEvent(hash))?.status).toBe('queued');
      await parked.database.prepare('DROP TABLE package_briefings').run();
    } finally {
      await parked.dispose();
    }

    // The restart must observe the missing table, so this runtime does not reinstall the schema.
    const resumed = await startRuntime({ stateDir, installSchema: false });
    try {
      const failed = await waitForJobEvent(resumed, hash, (event) => event.status === 'unavailable', 90_000);
      expect(failed).toMatchObject({ status: 'unavailable', reason: 'cache-error' });
      expect(provider.requestsFor(packet.packageName)).toBe(0);

      await installBriefingSchema(resumed.database);
      expect((await resumed.submit(packet)).submission?.status).toMatch(/queued|running/);
      expect(await waitForStoredBriefing(resumed.database, hash)).toMatchObject({ status: 'available', model: MODEL });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await resumed.dispose();
    }
  }, 120_000);

  it('stores the packet before acknowledging, and the 30-second alarm redelivers after a crash', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('dispatch-recovery-fixture', '12.0.0', '12.1.0');
    const hash = briefingEvidenceHash(packet);

    const parked = await startRuntime({ stateDir, producer: false, consumer: false });
    try {
      const queued = await parked.submit(packet);
      expect(queued.submission?.status).toBe('queued');
      expect((await parked.jobEvent(hash))?.status).toBe('queued');
      await delay(QUIET_MS);
      expect(provider.requestsFor(packet.packageName)).toBe(0);
      expect(await readStoredBriefing(parked.database, hash)).toBeUndefined();
    } finally {
      await parked.dispose();
    }

    const resumed = await startRuntime({ stateDir });
    try {
      // The redelivery comes from the 30-second recovery alarm, so this window spans that alarm plus the generation.
      const stored = await waitForStoredBriefing(resumed.database, hash, 90_000);
      expect(stored).toMatchObject({ status: 'available', model: MODEL });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await resumed.dispose();
    }
  }, 150_000);
});
