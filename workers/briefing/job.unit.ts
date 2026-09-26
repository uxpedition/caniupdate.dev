// Integration tests for the briefing job Worker. Every case runs the real Worker bundle, a real SQLite-backed Durable
// Object, the real Queue producer/consumer and a real D1 database inside one Miniflare instance, and reaches the
// private submission path through an actual service binding to the named `BriefingSubmitter` entrypoint. The harness
// these cases share — bundling, runtime, provider stub, waits and fault injectors — lives in `test/worker.harness.ts`.

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing, BriefingEvidence } from '#shared/briefing.defs';
import { decodeBriefingSubmission, type BriefingJobEvent } from '#shared/briefingJob.defs';

import { briefingEvidenceHash } from '../../server/utils/packageBriefing';
import { readStoredBriefing, saveBriefing } from '../../server/utils/packageBriefingStore';
import {
  FIXTURE_API_KEY,
  MODEL,
  SOURCE_ID,
  providerFixture,
  startProviderFixture,
  validBullets,
  type ProviderFixture,
} from './test/provider.stub';
import {
  JOB_WAIT_MS,
  LEASE_WAIT_MS,
  PUBLIC_URL,
  QUIET_MS,
  installBriefingSchema,
  openStateDir,
  packetFor,
  pendingOf,
  removeStateDirs,
  startRuntime,
  waitFor,
  waitForJobEvent,
  waitForStoredBriefing,
  type RuntimeFixture,
} from './test/worker.harness';

let provider: ProviderFixture;
let main: RuntimeFixture;

/**
 * Park a generation in `running` behind a stalled provider call and kill its runtime before it can commit, which is
 * the crash every restart case starts from. The fault is real — a stalled response and a disposed runtime — so no
 * part of it needs a hook in the Worker.
 */
async function crashRunningGeneration(stateDir: string, packet: BriefingEvidence): Promise<string> {
  const hash = briefingEvidenceHash(packet);
  const fixture = providerFixture();

  fixture.setMode({ kind: 'stall' });
  const crashed = await startRuntime({ stateDir });
  try {
    const parked = await crashed.submit(packet);
    if (parked.submission?.status !== 'queued') {
      throw new Error(`Expected the crash fixture to park this submission as queued: ${JSON.stringify(parked)}`);
    }
    await waitFor(
      async () => (fixture.requestsFor(packet.packageName) >= 1 ? true : undefined),
      JOB_WAIT_MS,
      'the provider call',
    );
    await waitForJobEvent(crashed, hash, (event) => event.status === 'running');
  } finally {
    await crashed.dispose();
    fixture.setMode({ kind: 'valid' });
    fixture.releaseStalls();
  }
  return hash;
}

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
  it('queues a cold submission, generates once, and stores the result for the hash', async () => {
    const packet = packetFor('cold-fixture', '3.0.0', '3.1.0');
    const hash = briefingEvidenceHash(packet);

    const queued = await main.submit(packet);

    expect(queued.error).toBeUndefined();
    expect(queued.submission).toMatchObject({
      status: 'queued',
      packageName: packet.packageName,
      from: packet.from,
      to: packet.to,
      hash,
      revision: 1,
      eventsUrl: `${PUBLIC_URL}/api/briefings/${hash}/events`,
    });

    const stored = await waitForStoredBriefing(main.database, hash);
    expect(stored).toMatchObject({ status: 'available', model: MODEL });
    expect(stored.bullets).toEqual(validBullets);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    // The D1 row is the authority the object projects, not a copy kept in the object.
    const event = await waitForJobEvent(main, hash, (candidate) => candidate.status === 'available');
    expect(event).toMatchObject({ status: 'available', briefing: stored });
  }, 60_000);

  it('crosses the service binding as JSON text the strict decode accepts', async () => {
    const packet = packetFor('boundary-fixture', '19.0.0', '19.1.0');
    const hash = briefingEvidenceHash(packet);

    // The wire contract the Nuxt route consumes, asserted at the real `BRIEFING_SERVICE` binding rather than at a
    // stub. An object answer is what failed in the built runtime: workerd attaches an own `Symbol.dispose` to
    // RPC-returned objects, and `decodeBriefingSubmission` refuses every undeclared own key, symbols included. The
    // `symbols` channel reports that decoration where the runtime reproduces it (a JSON round trip would drop it)
    // and stays empty here when only the emulator's bridge carries the value.
    const raw = await main.rawSubmit(packet);
    expect(raw.error).toBeUndefined();
    expect({ kind: raw.kind, symbols: raw.symbols }).toEqual({ kind: 'string', symbols: [] });
    const text = raw.text;
    if (text === undefined) throw new Error('The entrypoint did not answer JSON text across the service binding');

    const submission = decodeBriefingSubmission(JSON.parse(text));
    expect(submission).toMatchObject({
      packageName: packet.packageName,
      from: packet.from,
      to: packet.to,
      hash,
      eventsUrl: `${PUBLIC_URL}/api/briefings/${hash}/events`,
    });
    expect(submission.status).toMatch(/queued|running/);

    // The identity survives past the envelope: the job the text addressed is the one the hash keys in D1.
    expect(await waitForStoredBriefing(main.database, hash)).toMatchObject({ status: 'available', model: MODEL });
    expect(provider.requestsFor(packet.packageName)).toBe(1);
  }, 120_000);

  it('collapses two simultaneous same-hash submissions into one paid call', async () => {
    const packet = packetFor('race-fixture', '2.0.0', '2.1.0');
    const hash = briefingEvidenceHash(packet);

    const [first, second] = await Promise.all([main.submit(packet), main.submit(packet)]);

    const firstPending = pendingOf(first);
    const secondPending = pendingOf(second);
    expect(firstPending.status).toMatch(/queued|running/);
    expect(secondPending.status).toMatch(/queued|running/);
    expect(secondPending.hash).toBe(hash);
    // The consumer may claim the generation between the two submissions, so the second revision only has to be current.
    expect(secondPending.revision).toBeGreaterThanOrEqual(firstPending.revision);

    const stored = await waitForStoredBriefing(main.database, hash);
    expect(stored).toMatchObject({ status: 'available', model: MODEL });
    expect(provider.requestsFor(packet.packageName)).toBe(1);
  }, 60_000);

  it('returns the persisted first-writer result for a warm submit without provider configuration', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('warm-fixture', '1.0.0', '1.0.1');
    const hash = briefingEvidenceHash(packet);

    const configured = await startRuntime({ stateDir });
    try {
      expect((await configured.submit(packet)).submission?.status).toMatch(/queued|running/);
      await waitForStoredBriefing(configured.database, hash);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await configured.dispose();
    }

    const unconfigured = await startRuntime({ stateDir, aiConfig: false });
    try {
      const warm = await unconfigured.submit(packet);
      expect(warm.submission).toMatchObject({ status: 'available', briefing: { status: 'available', model: MODEL } });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await unconfigured.dispose();
    }
  }, 120_000);

  it('treats changed evidence as a different job with its own hash', async () => {
    const first = packetFor('changed-fixture', '1.0.0', '1.1.0');
    const second = packetFor('changed-fixture', '1.0.0', '1.2.0');

    const firstResult = await main.submit(first);
    const secondResult = await main.submit(second);

    expect(pendingOf(firstResult).hash).toBe(briefingEvidenceHash(first));
    expect(pendingOf(secondResult).hash).toBe(briefingEvidenceHash(second));
    expect(pendingOf(firstResult).hash).not.toBe(pendingOf(secondResult).hash);

    await waitForStoredBriefing(main.database, briefingEvidenceHash(second));
    expect(provider.requestsFor(first.packageName)).toBe(2);
  }, 60_000);

  it('refuses a public submission without queueing, generating, or storing anything', async () => {
    const packet = packetFor('public-fixture', '4.0.0', '4.1.0');
    const hash = briefingEvidenceHash(packet);

    const response = await main.publicPost(
      'https://briefing.example/api/package/public-fixture/compare/briefing',
      packet,
    );

    expect(response.status).toBe(405);
    expect(response.text).not.toContain(packet.packageName);
    expect(response.text).not.toContain(MODEL);
    expect(response.text).not.toContain(FIXTURE_API_KEY);
    expect(response.text).not.toContain(provider.endpoint);

    await delay(QUIET_MS);
    expect(provider.requestsFor(packet.packageName)).toBe(0);
    expect(await readStoredBriefing(main.database, hash)).toBeUndefined();
    expect(await main.jobEvent(hash)).toBeUndefined();
  }, 60_000);

  it('rejects an undecodable packet and a packet that does not hash to the addressed job', async () => {
    const packet = packetFor('mismatch-fixture', '14.0.0', '14.1.0');
    const addressed = packetFor('mismatch-other', '14.0.0', '14.1.0');
    const addressedHash = briefingEvidenceHash(addressed);

    const undecodable = await main.submit({ ...packet, packageName: '   ' });
    expect(undecodable).toMatchObject({ httpStatus: 503, error: 'invalid-response' });

    const mismatched = await main.submitToJob(addressedHash, packet);
    expect(mismatched).toMatchObject({ httpStatus: 503, error: 'invalid-response' });

    await delay(QUIET_MS);
    expect(provider.requestsFor(packet.packageName)).toBe(0);
    expect(await main.jobEvent(addressedHash)).toBeUndefined();
    expect(await readStoredBriefing(main.database, addressedHash)).toBeUndefined();
  }, 60_000);

  it('rejects a cold submission when D1 is unreadable, then recovers once the schema returns', async () => {
    const stateDir = await openStateDir();
    const runtime = await startRuntime({ stateDir });
    const packet = packetFor('d1-read-fixture', '5.0.0', '5.1.0');
    const hash = briefingEvidenceHash(packet);
    try {
      await runtime.database.prepare('DROP TABLE package_briefings').run();

      const rejected = await runtime.submit(packet);
      expect(rejected).toMatchObject({ httpStatus: 503, error: 'cache-error' });
      expect(await runtime.jobEvent(hash)).toBeUndefined();

      await installBriefingSchema(runtime.database);
      expect((await runtime.submit(packet)).submission?.status).toMatch(/queued|running/);
      expect(await waitForStoredBriefing(runtime.database, hash)).toMatchObject({ status: 'available', model: MODEL });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await runtime.dispose();
    }
  }, 120_000);

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

  it('never reports durable success when the D1 write is refused', async () => {
    const stateDir = await openStateDir();
    const runtime = await startRuntime({ stateDir });
    const packet = packetFor('d1-write-fixture', '7.0.0', '7.1.0');
    const hash = briefingEvidenceHash(packet);
    try {
      await runtime.database
        .prepare(
          "CREATE TRIGGER package_briefings_reject_insert BEFORE INSERT ON package_briefings BEGIN SELECT RAISE(ABORT, 'fixture: D1 write refused'); END",
        )
        .run();

      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      const failed = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable');
      expect(failed).toMatchObject({ status: 'unavailable', reason: 'cache-error' });
      // The paid call happened; the row was refused, so the job could not become available.
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      const rows = await runtime.database
        .prepare('SELECT count(*) AS total FROM package_briefings')
        .first<{ total: number }>();
      expect(rows?.total).toBe(0);

      await runtime.database.prepare('DROP TRIGGER package_briefings_reject_insert').run();
      expect((await runtime.submit(packet)).submission?.status).toMatch(/queued|running/);
      expect(await waitForStoredBriefing(runtime.database, hash)).toMatchObject({ status: 'available', model: MODEL });
      expect(provider.requestsFor(packet.packageName)).toBe(2);
    } finally {
      await runtime.dispose();
    }
  }, 120_000);

  it('commits unavailable after two invalid model outputs without storing anything', async () => {
    const packet = packetFor('invalid-output-fixture', '8.0.0', '8.1.0');
    const hash = briefingEvidenceHash(packet);
    provider.setMode({ kind: 'invalid' });
    try {
      expect((await main.submit(packet)).submission?.status).toBe('queued');
      const failed = await waitForJobEvent(main, hash, (event) => event.status === 'unavailable');
      expect(failed).toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
      expect(provider.requestsFor(packet.packageName)).toBe(2);
      expect(await readStoredBriefing(main.database, hash)).toBeUndefined();
    } finally {
      provider.setMode({ kind: 'valid' });
    }
  }, 120_000);

  it('commits unavailable after a provider HTTP failure without a second call', async () => {
    const packet = packetFor('http-error-fixture', '9.0.0', '9.1.0');
    const hash = briefingEvidenceHash(packet);
    provider.setMode({ kind: 'http-error' });
    try {
      expect((await main.submit(packet)).submission?.status).toBe('queued');
      const failed = await waitForJobEvent(main, hash, (event) => event.status === 'unavailable');
      expect(failed).toMatchObject({ status: 'unavailable', reason: 'provider-error' });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(await readStoredBriefing(main.database, hash)).toBeUndefined();
    } finally {
      provider.setMode({ kind: 'valid' });
    }
  }, 120_000);

  it('does not regenerate when the same generation is delivered twice', async () => {
    const packet = packetFor('duplicate-fixture', '10.0.0', '10.1.0');
    const hash = briefingEvidenceHash(packet);
    provider.setMode({ kind: 'stall' });
    try {
      expect((await main.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(main, hash, (event) => event.status === 'running');

      const queue = main.queue;
      if (queue === undefined) throw new Error('The fixture runtime has no Queue producer');
      await queue.send({ hash, generationId: 1 });
      await delay(QUIET_MS);
      expect(provider.requestsFor(packet.packageName)).toBe(1);

      provider.releaseStalls();
      const stored = await waitForStoredBriefing(main.database, hash);
      const completed = await waitForJobEvent(main, hash, (event) => event.status === 'available');
      expect(completed.revision).toBeGreaterThan(running.revision);
      expect(completed).toMatchObject({ status: 'available', briefing: stored });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
    }
  }, 120_000);

  it('never regenerates for a stale generation message', async () => {
    const packet = packetFor('stale-fixture', '11.0.0', '11.1.0');
    const hash = briefingEvidenceHash(packet);
    provider.setMode({ kind: 'stall' });
    try {
      expect((await main.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );

      const queue = main.queue;
      if (queue === undefined) throw new Error('The fixture runtime has no Queue producer');
      await queue.send({ hash, generationId: 0 });
      await delay(QUIET_MS);
      expect(provider.requestsFor(packet.packageName)).toBe(1);

      provider.releaseStalls();
      const stored = await waitForStoredBriefing(main.database, hash);
      expect(stored).toMatchObject({ status: 'available', model: MODEL });
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
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

  it('makes dispatch failure terminal after three attempts instead of queueing forever', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('dispatch-exhaustion-fixture', '13.0.0', '13.1.0');
    const hash = briefingEvidenceHash(packet);

    const parked = await startRuntime({ stateDir, producer: false, consumer: false });
    try {
      expect((await parked.submit(packet)).submission?.status).toBe('queued');
      const failed = await waitForJobEvent(parked, hash, (event) => event.status === 'unavailable', 120_000);
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
          evidenceIds: [SOURCE_ID],
        },
      ],
      sources: packet.sources,
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

  it('reports a storage outage at lease reconciliation as cache-error rather than a timeout', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('crash-outage-fixture', '18.0.0', '18.1.0');

    const hash = await crashRunningGeneration(stateDir, packet);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    const resumed = await startRuntime({ stateDir });
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
