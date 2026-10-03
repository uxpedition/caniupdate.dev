// Integration tests for the briefing job Worker's submission and generation paths: the service-binding wire contract,
// same-hash coalescing, D1-backed reuse and refusal semantics, and provider-fault handling. Every case runs the real
// Worker bundle, a real SQLite-backed Durable Object, the real Queue producer/consumer and a real D1 database inside
// one Miniflare instance. The shared harness lives in `test/worker.harness.ts`; the timer-bound dispatch and lease
// recovery cases live in the sibling suites of this directory so they can run in parallel with this file.

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { briefingEvidenceHash } from '../../../server/utils/packageBriefing';
import { readStoredBriefing } from '../../../server/utils/packageBriefingStore';
import {
  FIXTURE_API_KEY,
  MODEL,
  responseBullets,
  startProviderFixture,
  type ProviderFixture,
} from '../test/provider.stub';
import {
  JOB_WAIT_MS,
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
    expect(stored.bullets).toEqual(responseBullets);
    expect(provider.requestsFor(packet.packageName)).toBe(1);

    // The D1 row is the authority the object projects, not a copy kept in the object.
    const event = await waitForJobEvent(main, hash, (candidate) => candidate.status === 'available');
    expect(event).toMatchObject({ status: 'available', briefing: stored });
  }, 60_000);

  it('crosses the service binding as a native object and preserves its strict envelope', async () => {
    const packet = packetFor('boundary-fixture', '19.0.0', '19.1.0');
    const hash = briefingEvidenceHash(packet);

    // The regular harness path models a caller that serializes only the application envelope after receiving the
    // native RPC object. It must accept the service response before the raw path checks the wire value itself.
    const submitted = await main.submit(packet);
    expect(submitted.error).toBeUndefined();
    expect(submitted.submission).toMatchObject({
      packageName: packet.packageName,
      from: packet.from,
      to: packet.to,
    });

    // This is the real service binding from the built Worker bundle. The raw channel avoids JSON conversion so a
    // regression to text cannot hide behind the harness's public JSON response.
    const raw = await main.rawSubmit(packet);
    expect(raw.error).toBeUndefined();
    expect(raw.kind).toBe('object');
    expect(raw.text).toBeUndefined();

    // The identity survives past the envelope: the job the native object addressed is the one the hash keys in D1.
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
});
