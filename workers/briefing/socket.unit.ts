// Integration tests for the briefing Worker's public read-only socket surface. Every case runs the real runtime: a
// browser-shaped upgrade through the public route (Miniflare's `dispatchFetch` against the briefing Worker, carrying
// the configured `Origin`), the real hibernating WebSocket API inside the SQLite-backed Durable Object, and the
// standard WebSocket API on the client side. Sockets are refused, closed, evicted and restarted for real — nothing
// here fabricates frames in process, because only the runtime establishes browser routing and hibernation.

import { setTimeout as delay } from 'node:timers/promises';

import type { WebSocket as RuntimeWebSocket } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing } from '#shared/briefing.defs';
import { decodeBriefingJobEvent, type BriefingJobEvent } from '#shared/briefingJob.defs';

import { briefingEvidenceHash } from '../../server/utils/packageBriefing';
import { readStoredBriefing } from '../../server/utils/packageBriefingStore';
import { FIXTURE_API_KEY, MODEL, providerFixture, startProviderFixture } from './test/provider.stub';
import {
  BRIEFING_ENVIRONMENTS,
  JOB_WAIT_MS,
  QUIET_MS,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  waitFor,
  waitForJobEvent,
  waitForStoredBriefing,
  type RuntimeFixture,
} from './test/worker.harness';

/** A well-formed hash no submission in these runtimes ever created. */
const UNKNOWN_HASH = '0'.repeat(64);
/** An Origin that is nobody's configured site. */
const FOREIGN_ORIGIN = 'https://briefing-attacker.example';
const CLOSE = { code: 1000, reason: 'briefing complete' };

/** One browser-side subscription: the handshake status, the text frames in arrival order, and the server's close. */
type Subscription = {
  readonly status: number;
  /** Text frames exactly as the Worker sent them; a non-text frame reads as `[binary]` so a decoder failure is loud. */
  readonly frames: readonly string[];
  /** Resolves with the close the server sent; it only settles once the server closes. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  /** The frames decoded as `BriefingJobEvent` envelopes; an illegal frame throws rather than being ignored. */
  events(): BriefingJobEvent[];
  send(message: string): void;
  close(): void;
};

/**
 * Dial the public read-only route for one hash exactly as a browser on the allowed origin would: an upgrade request
 * carrying `Origin`, through the real runtime, then the standard WebSocket API. A refused handshake throws, because a
 * case that expects one asserts on `publicFetch` instead. Returns once the first frame has arrived, so a caller reads
 * `frames` without racing the server.
 */
async function subscribe(
  fixture: RuntimeFixture,
  hash: string,
  origin: string = fixture.allowedOrigin,
): Promise<Subscription> {
  const response = await fixture.publicFetch(fixture.eventsUrl(hash), {
    headers: { Upgrade: 'websocket', Origin: origin },
  });
  const socket: RuntimeWebSocket | null = response.webSocket;
  if (socket === null) {
    throw new Error(`The public route refused the upgrade for ${hash} with status ${response.status}`);
  }

  const frames: string[] = [];
  const closed = Promise.withResolvers<{ code: number; reason: string }>();
  socket.accept();
  socket.addEventListener('message', (event) => {
    frames.push(typeof event.data === 'string' ? event.data : '[binary]');
  });
  socket.addEventListener('close', (event) => {
    closed.resolve({ code: event.code, reason: event.reason });
  });

  await waitFor(async () => frames.at(0), JOB_WAIT_MS, `the first frame the public route sent for ${hash}`);

  return {
    status: response.status,
    frames,
    closed: closed.promise,
    events: (): BriefingJobEvent[] => frames.map((frame) => decodeBriefingJobEvent(JSON.parse(frame))),
    send: (message: string): void => socket.send(message),
    close: (): void => socket.close(1000, 'test closed'),
  };
}

beforeAll(async () => {
  await startProviderFixture();
}, 30_000);

afterAll(async () => {
  await providerFixture().close();
  await removeStateDirs();
});

describe('public read-only upgrade', () => {
  for (const environment of ['local', 'preview'] as const) {
    describe(`${environment} configuration`, () => {
      let runtime: RuntimeFixture;
      let hash: string;
      let stored: AvailablePackageBriefing;
      let settledRevision: number;
      let deliveries: number;

      beforeAll(async () => {
        runtime = await startRuntime({ stateDir: await openStateDir(), environment });
        const packet = packetFor(`route-${environment}`, '1.0.0', '1.1.0');
        hash = briefingEvidenceHash(packet);

        expect((await runtime.submit(packet)).submission?.status).toBe('queued');
        stored = await waitForStoredBriefing(runtime.database, hash);
        settledRevision = (await waitForJobEvent(runtime, hash, (event) => event.status === 'available')).revision;
        deliveries = runtime.queueDeliveries();
        expect(deliveries).toBeGreaterThan(0);
      }, 120_000);

      afterAll(async () => {
        await runtime.dispose();
      });

      it('completes the upgrade from the configured exact Origin and sends the canonical briefing', async () => {
        const subscription = await subscribe(runtime, hash);

        expect(subscription.status).toBe(101);
        expect(subscription.frames.join()).not.toContain(FIXTURE_API_KEY);
        expect(subscription.frames.join()).not.toContain(providerFixture().endpoint);
        await expect(subscription.closed).resolves.toEqual(CLOSE);
        expect(subscription.events()).toEqual([{ status: 'available', revision: settledRevision, briefing: stored }]);
      }, 60_000);

      it.each([
        [
          "the other configuration's Origin",
          BRIEFING_ENVIRONMENTS[environment === 'local' ? 'preview' : 'local'].allowedOrigin,
        ],
        ['an unrelated Origin', FOREIGN_ORIGIN],
      ] as const)(
        'refuses %s without upgrading',
        async (_label, origin) => {
          const response = await runtime.publicFetch(runtime.eventsUrl(hash), {
            headers: { Upgrade: 'websocket', Origin: origin },
          });

          expect(response.status).toBe(403);
          expect(response.webSocket).toBeNull();
        },
        60_000,
      );

      it('refuses an upgrade that carries no Origin at all', async () => {
        const response = await runtime.publicFetch(runtime.eventsUrl(hash), {
          headers: { Upgrade: 'websocket' },
        });

        expect(response.status).toBe(403);
        expect(response.webSocket).toBeNull();
      }, 60_000);

      it.each([
        ['a truncated hash', (candidate: string) => candidate.slice(0, 63)],
        ['an uppercase hash', () => 'A'.repeat(64)],
        ['a non-hex hash', () => 'z'.repeat(64)],
        ['a hash with a trailing path segment', (candidate: string) => `${candidate}/events`],
      ] as const)(
        'refuses %s',
        async (_label, mutate) => {
          const response = await runtime.publicFetch(runtime.eventsUrl(mutate(hash)), {
            headers: { Upgrade: 'websocket', Origin: runtime.allowedOrigin },
          });

          expect(response.status).toBe(404);
          expect(response.webSocket).toBeNull();
        },
        60_000,
      );

      it('refuses a well-formed hash that names no job', async () => {
        const response = await runtime.publicFetch(runtime.eventsUrl(UNKNOWN_HASH), {
          headers: { Upgrade: 'websocket', Origin: runtime.allowedOrigin },
        });

        expect(response.status).toBe(404);
        expect(response.webSocket).toBeNull();
      }, 60_000);

      it('refuses a request on the events path that is not an upgrade', async () => {
        const response = await runtime.publicFetch(runtime.eventsUrl(hash), {
          headers: { Origin: runtime.allowedOrigin },
        });

        expect(response.status).toBe(426);
        expect(response.webSocket).toBeNull();
      }, 60_000);

      it('refuses a public POST without queueing, generating, or changing the job', async () => {
        const packet = packetFor(`posted-${environment}`, '1.0.0', '1.1.0');
        const response = await runtime.publicFetch(runtime.eventsUrl(hash), {
          method: 'POST',
          headers: { 'content-type': 'application/json', Origin: runtime.allowedOrigin },
          body: JSON.stringify(packet),
        });

        expect(response.status).toBe(405);
        expect(response.webSocket).toBeNull();
        expect(await response.text()).not.toContain(FIXTURE_API_KEY);

        await delay(QUIET_MS);
        expect(runtime.queueDeliveries()).toBe(deliveries);
        expect(providerFixture().requestsFor(packet.packageName)).toBe(0);
        expect(await readStoredBriefing(runtime.database, briefingEvidenceHash(packet))).toBeUndefined();
        expect((await waitForJobEvent(runtime, hash, (event) => event.status === 'available')).revision).toBe(
          settledRevision,
        );
      }, 60_000);
    });
  }
});

describe('origin allow-list', () => {
  const TAILSCALE_ORIGIN = 'http://100.122.224.20:5173';
  const LAN_ORIGIN = 'http://192.168.101.197:5173';
  let runtime: RuntimeFixture;
  let hash: string;

  beforeAll(async () => {
    // The value the launcher writes when the page is served on every interface: the loopback alias plus each address a
    // device may open it with, and the spaces a hand-written list may carry.
    runtime = await startRuntime({
      stateDir: await openStateDir(),
      allowedOrigin: [BRIEFING_ENVIRONMENTS.local.allowedOrigin, TAILSCALE_ORIGIN, LAN_ORIGIN].join(', '),
    });
    const packet = packetFor('origin-list', '3.0.0', '3.1.0');
    hash = briefingEvidenceHash(packet);
    expect((await runtime.submit(packet)).submission?.status).toBe('queued');
    await waitForStoredBriefing(runtime.database, hash);
  }, 120_000);

  afterAll(async () => {
    await runtime.dispose();
  });

  it.each([[TAILSCALE_ORIGIN], [LAN_ORIGIN]])(
    'upgrades from %s, a later Origin in the list',
    async (origin) => {
      const subscription = await subscribe(runtime, hash, origin);

      expect(subscription.status).toBe(101);
      await expect(subscription.closed).resolves.toEqual(CLOSE);
    },
    60_000,
  );

  it.each([
    ['an Origin the list does not name', FOREIGN_ORIGIN],
    ['a host that only starts like a listed Origin', `${TAILSCALE_ORIGIN}.attacker.example`],
    ['a missing Origin', undefined],
  ] as const)(
    'refuses an upgrade from %s',
    async (_label, origin) => {
      const response = await runtime.publicFetch(runtime.eventsUrl(hash), {
        headers: origin === undefined ? { Upgrade: 'websocket' } : { Upgrade: 'websocket', Origin: origin },
      });

      expect(response.status).toBe(403);
      expect(response.webSocket).toBeNull();
    },
    60_000,
  );
});

describe('hibernating subscribers', () => {
  it('sends a pending snapshot, then exactly one canonical available frame, then the close', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-pending', '2.0.0', '2.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      expect(subscription.events()).toEqual([{ status: 'running', revision: running.revision }]);

      provider.releaseStalls();
      const stored = await waitForStoredBriefing(runtime.database, hash);
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'available');

      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(settled.revision).toBeGreaterThan(running.revision);
      expect(subscription.events()).toEqual([
        { status: 'running', revision: running.revision },
        { status: 'available', revision: settled.revision, briefing: stored },
      ]);
      expect(subscription.frames.join()).not.toContain(FIXTURE_API_KEY);
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);

  it('gives a subscriber that attaches after completion one canonical frame and the close', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-completed', '3.0.0', '3.1.0');
    const hash = briefingEvidenceHash(packet);
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      const stored = await waitForStoredBriefing(runtime.database, hash);
      expect(stored).toMatchObject({ status: 'available', model: MODEL });
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'available');

      const subscription = await subscribe(runtime, hash);

      expect(subscription.status).toBe(101);
      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([{ status: 'available', revision: settled.revision, briefing: stored }]);
    } finally {
      await runtime.dispose();
    }
  }, 60_000);

  it('reconnects after a real process restart from persistence alone, with no queue or provider work', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-restart', '4.0.0', '4.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();

    let durable: { revision: number; briefing: AvailablePackageBriefing } | undefined;
    const before = await startRuntime({ stateDir });
    try {
      expect((await before.submit(packet)).submission?.status).toBe('queued');
      const briefing = await waitForStoredBriefing(before.database, hash);
      const settled = await waitForJobEvent(before, hash, (event) => event.status === 'available');
      durable = { revision: settled.revision, briefing };
      // The counter observes the one paid generation before this case asks it to observe nothing.
      expect(before.queueDeliveries()).toBeGreaterThan(0);
    } finally {
      await before.dispose();
    }
    if (durable === undefined) throw new Error('The first runtime never settled this job');

    // A fresh runtime against the same persistence directory: the object that owned the job is gone.
    const after = await startRuntime({ stateDir });
    try {
      expect(after.queueDeliveries()).toBe(0);
      const subscription = await subscribe(after, hash);

      expect(subscription.status).toBe(101);
      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([
        { status: 'available', revision: durable.revision, briefing: durable.briefing },
      ]);
      expect(after.queueDeliveries()).toBe(0);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
    } finally {
      await after.dispose();
    }
  }, 120_000);

  it('delivers the terminal frame to a subscriber that survives a real object eviction', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-evicted', '5.0.0', '5.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    // This runtime has no Queue producer, so only the job's own dispatch-recovery alarm can settle it — the durable
    // path a subscriber has to be reachable from after the object that accepted it was evicted.
    const runtime = await startRuntime({ stateDir, producer: false, consumer: false });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      const queued = await waitForJobEvent(runtime, hash, (event) => event.status === 'queued');

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      expect(subscription.events()).toEqual([{ status: 'queued', revision: queued.revision }]);

      // Real eviction, hibernating the accepted socket: the object is gone, and what wakes it next is its alarm.
      await runtime.evictJob(hash);

      // Two further dispatch attempts, thirty seconds apart, are what make this job terminal — so the frame below
      // reaches a socket that outlived the object which accepted it.
      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable', 120_000);
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'provider-error' });
      expect(settled.revision).toBeGreaterThan(queued.revision);

      await expect(subscription.closed).resolves.toEqual(CLOSE);
      expect(subscription.events()).toEqual([
        { status: 'queued', revision: queued.revision },
        { status: 'unavailable', revision: settled.revision, reason: 'provider-error' },
      ]);
      // No dispatch ever reached a Queue, so nothing paid for a generation the browser was not waiting on.
      expect(provider.requestsFor(packet.packageName)).toBe(0);
      expect(await readStoredBriefing(runtime.database, hash)).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  }, 240_000);

  it('settles a second invalid model output as unavailable and closes every subscriber', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-invalid-output', '6.0.0', '6.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');

      const first = await subscribe(runtime, hash);
      const second = await subscribe(runtime, hash);
      expect([first.status, second.status]).toEqual([101, 101]);
      expect(first.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(second.events()).toEqual([{ status: 'running', revision: running.revision }]);

      // The held request is released into the invalid mode, so the generator's one retry is invalid as well.
      provider.setMode({ kind: 'invalid' });
      provider.releaseStalls();

      const settled = await waitForJobEvent(runtime, hash, (event) => event.status === 'unavailable');
      expect(settled).toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
      expect(provider.requestsFor(packet.packageName)).toBe(2);

      await expect(first.closed).resolves.toEqual(CLOSE);
      await expect(second.closed).resolves.toEqual(CLOSE);
      expect(settled.revision).toBeGreaterThan(running.revision);
      expect(first.events()).toEqual([
        { status: 'running', revision: running.revision },
        { status: 'unavailable', revision: settled.revision, reason: 'invalid-response' },
      ]);
      expect(second.events()).toEqual(first.events());
      expect(await readStoredBriefing(runtime.database, hash)).toBeUndefined();
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);

  it('creates no queue or provider work from client frames or from a reconnect', async () => {
    const stateDir = await openStateDir();
    const packet = packetFor('socket-quiet', '7.0.0', '7.1.0');
    const hash = briefingEvidenceHash(packet);
    const provider = providerFixture();
    provider.setMode({ kind: 'stall' });
    const runtime = await startRuntime({ stateDir });
    try {
      expect((await runtime.submit(packet)).submission?.status).toBe('queued');
      await waitFor(
        async () => (provider.requestsFor(packet.packageName) >= 1 ? true : undefined),
        JOB_WAIT_MS,
        'the provider call',
      );
      const running = await waitForJobEvent(runtime, hash, (event) => event.status === 'running');
      // A delivery is only logged when the broker's flush returns, and this job's generation is still stalled. The
      // counter therefore starts at zero here and the case proves it observes a real delivery at the end.
      const deliveries = runtime.queueDeliveries();

      const subscription = await subscribe(runtime, hash);
      expect(subscription.status).toBe(101);
      subscription.send('junk');
      subscription.send(JSON.stringify({ status: 'retry', hash, generationId: 1 }));
      subscription.send(JSON.stringify({ action: 'resubmit', revision: running.revision, packet }));
      subscription.send('');

      await delay(QUIET_MS);
      expect(subscription.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(runtime.queueDeliveries()).toBe(deliveries);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(await runtime.jobEvent(hash)).toEqual({ status: 'running', revision: running.revision });

      subscription.close();
      const reconnected = await subscribe(runtime, hash);
      await delay(QUIET_MS);

      expect(reconnected.status).toBe(101);
      expect(reconnected.events()).toEqual([{ status: 'running', revision: running.revision }]);
      expect(runtime.queueDeliveries()).toBe(deliveries);
      expect(provider.requestsFor(packet.packageName)).toBe(1);
      expect(await runtime.jobEvent(hash)).toEqual({ status: 'running', revision: running.revision });

      // Positive control for the counter this case just held constant: releasing the stalled generation lets its own
      // queue message finish, which is the one delivery this runtime logs.
      provider.releaseStalls();
      await waitForStoredBriefing(runtime.database, hash);
      await waitFor(
        async () => (runtime.queueDeliveries() > deliveries ? true : undefined),
        JOB_WAIT_MS,
        'the queue delivery line for the stalled generation',
      );
    } finally {
      provider.setMode({ kind: 'valid' });
      provider.releaseStalls();
      await runtime.dispose();
    }
  }, 120_000);
});
