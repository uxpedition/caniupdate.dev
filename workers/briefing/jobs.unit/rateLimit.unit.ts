import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { briefingEvidenceHash } from '../../../server/comparison/briefing/generation';
import { saveBriefing } from '../../../server/comparison/briefing/store';
import { startProviderFixture, type ProviderFixture } from '../test/provider.stub';
import { openStateDir, packetFor, removeStateDirs, startRuntime, waitForJobEvent } from '../test/worker.harness';

let provider: ProviderFixture;

beforeAll(async () => {
  provider = await startProviderFixture();
});

afterAll(async () => {
  await provider.close();
  await removeStateDirs();
});

describe('managed generation admission', () => {
  it('coalesces concurrent acceptance and joins pending work after the caller allowance is exhausted', async () => {
    const runtime = await startRuntime({ stateDir: await openStateDir(), consumer: false, generationLimit: 1 });

    try {
      const packet = packetFor('rate-pending', '1.0.0', '2.0.0');
      const [first, second] = await Promise.all([runtime.submit(packet), runtime.submit(packet)]);
      expect(first.submission).toMatchObject({ status: 'queued', revision: 1 });
      expect(second.submission).toEqual(first.submission);
      expect((await runtime.submit(packetFor('rate-other', '1.0.0', '2.0.0'))).error).toBe('generation-rate-limited');
      expect((await runtime.submit(packet)).submission).toEqual(first.submission);
      // A separate network gets its own managed allowance, not a per-hash limit or global cap.
      expect(
        (await runtime.submit(packetFor('rate-other', '1.0.0', '2.0.0'), 'b'.repeat(64))).submission,
      ).toMatchObject({ status: 'queued', revision: 1 });
      expect(await runtime.jobEvent(briefingEvidenceHash(packet))).toEqual({ status: 'queued', revision: 1 });
      expect(runtime.structuredLogs().join('\n')).not.toContain('a'.repeat(64));
      expect(provider.providerRequests).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });

  it('serves D1 results without consuming the new-generation allowance', async () => {
    const runtime = await startRuntime({ stateDir: await openStateDir(), consumer: false, generationLimit: 1 });

    try {
      const packet = packetFor('rate-stored', '1.0.0', '2.0.0');

      const briefing = {
        status: 'available' as const,
        model: 'fixture',
        sources: packet.sources,
        bullets: [
          { kind: 'change' as const, basis: 'fact' as const, text: 'Node requirements changed.', evidenceNumbers: [1] },
        ],
      };

      await saveBriefing(runtime.database, briefingEvidenceHash(packet), briefing);
      expect((await runtime.submit(packet)).submission).toMatchObject({ status: 'available', briefing });
      expect((await runtime.submit(packetFor('rate-new', '1.0.0', '2.0.0'))).submission).toMatchObject({
        status: 'queued',
      });
      expect((await runtime.submit(packet)).submission).toMatchObject({ status: 'available', briefing });
      expect((await runtime.read(packet)).result).toMatchObject({ status: 'available', briefing });
    } finally {
      await runtime.dispose();
    }
  });

  it('charges explicit retries again and leaves a denied retry terminal without buying inference', async () => {
    provider.setMode({ kind: 'http-error' });
    const runtime = await startRuntime({ stateDir: await openStateDir(), generationLimit: 2 });
    const packet = packetFor('rate-retry', '1.0.0', '2.0.0');
    const hash = briefingEvidenceHash(packet);

    try {
      expect((await runtime.submit(packet)).submission).toMatchObject({ status: 'queued', revision: 1 });
      const first = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable');
      expect(first).toMatchObject({ status: 'unavailable', revision: 3 });
      expect((await runtime.submit(packet)).submission).toMatchObject({ status: 'queued', revision: 4 });

      const second = await waitForJobEvent(
        runtime,
        hash,
        (event) => event.status === 'unavailable' && event.revision > 3,
      );

      expect(second).toMatchObject({ status: 'unavailable', revision: 6 });
      expect((await runtime.submit(packet)).error).toBe('generation-rate-limited');
      expect(await runtime.jobEvent(hash)).toEqual(second);
      expect(provider.requestsFor(packet.packageName)).toBe(2);
    } finally {
      await runtime.dispose();
      provider.setMode({ kind: 'valid' });
    }
  });
});
