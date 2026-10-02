// Integration tests for the briefing Worker's public read-only socket surface: which upgrades are accepted from which
// Origin, which hashes and paths are refused, and that a public POST changes nothing. Every case runs the real
// runtime — a browser-shaped upgrade through the public route (Miniflare's `dispatchFetch` against the briefing
// Worker, carrying the configured `Origin`) and the real hibernating WebSocket API. The hibernation and eviction
// cases live in the sibling suites of this directory so they can run in parallel with this file.

import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing } from '#shared/briefing.defs';

import { briefingEvidenceHash } from '../../../server/utils/packageBriefing';
import { readStoredBriefing } from '../../../server/utils/packageBriefingStore';
import { FIXTURE_API_KEY, providerFixture, startProviderFixture } from '../test/provider.stub';
import {
  BRIEFING_ENVIRONMENTS,
  CLOSE,
  QUIET_MS,
  openStateDir,
  packetFor,
  removeStateDirs,
  startRuntime,
  subscribe,
  waitForJobEvent,
  waitForStoredBriefing,
  type RuntimeFixture,
} from '../test/worker.harness';

/** A well-formed hash no submission in these runtimes ever created. */
const UNKNOWN_HASH = '0'.repeat(64);
/** An Origin that is nobody's configured site. */
const FOREIGN_ORIGIN = 'https://briefing-attacker.example';

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
