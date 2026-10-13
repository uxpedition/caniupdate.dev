// A job whose Queue sends fail becomes terminal after three dispatch attempts; a later POST starts a new generation.
// The test-only clock advances to each persisted production deadline, with native workerd alarm delivery and a
// completion barrier between attempts. eviction.unit.ts keeps a wall-clock dispatch/hibernation guard.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BriefingJobEvent } from '#shared/comparison/briefing/briefingJob.defs';

import { briefingEvidenceHash } from '../../../server/comparison/briefing/generation';
import { readStoredBriefing } from '../../../server/comparison/briefing/store';
import { startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import {
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  waitForJobEvent,
  waitForStoredBriefing,
  type RuntimeFixture,
} from '../test/worker.harness';

let provider: ProviderFixture;

let main: RuntimeFixture;

beforeAll(async () => {
  provider = await startProviderFixture();
  main = await startRuntime({ stateDir: await openStateDir() });
}, 180_000);

afterAll(async () => {
  await main.dispose();
  await provider.close();
  await removeStateDirs();
});

describe('briefing job Worker', () => {
  it('makes dispatch failure terminal after three attempts instead of queueing forever', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('dispatch-exhaustion-fixture', '13.0.0', '13.1.0');
    const hash = briefingEvidenceHash(packet);

    const parked = await startRuntime({ stateDir, producer: false, consumer: false, controlledTime: true });

    try {
      expect((await parked.submit(packet)).submission?.status).toBe('queued');
      const queued = await parked.jobEvent(hash);
      await parked.fireNextAlarm(hash);
      expect(await parked.jobEvent(hash)).toEqual(queued);
      await parked.fireNextAlarm(hash);
      const failed = await waitForJobEvent(parked, hash, (event) => event.status === 'unavailable');
      expect(failed).toMatchObject({ status: 'unavailable', reason: 'provider-error' });
      expect(provider.requestsFor(packet.packageName)).toBe(0);
      expect(await readStoredBriefing(parked.database, hash)).toBeUndefined();
    } finally {
      await parked.dispose();
    }
  }, 180_000);

  it('starts a fresh generation from an explicit later POST after a terminal failure', async () => {
    const packet = packetFor('fresh-generation-fixture', '15.0.0', '15.1.0');
    const hash = briefingEvidenceHash(packet);

    provider.setMode({ kind: 'invalid' });
    let failed: BriefingJobEvent;

    try {
      expect((await main.submit(packet)).submission?.status).toBe('queued');
      failed = await waitForJobEvent(main, hash, (event) => event.status === 'unavailable');
    } finally {
      provider.setMode({ kind: 'valid' });
    }

    expect(failed).toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
    expect(provider.requestsFor(packet.packageName)).toBe(2);

    expect((await main.submit(packet)).submission?.status).toMatch(/queued|running/);
    const stored = await waitForStoredBriefing(main.database, hash);
    const completed = await waitForJobEvent(main, hash, (event) => event.status === 'available');
    expect(completed.revision).toBeGreaterThan(failed.revision);
    expect(provider.requestsFor(packet.packageName)).toBe(3);
    expect(completed).toMatchObject({ status: 'available', briefing: stored });
  }, 120_000);
});
