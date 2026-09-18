import { Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { getPackageBundleSize as lookupBundleSize } from './packageBundleSize';

let getPackageBundleSize: typeof lookupBundleSize;
beforeEach(async () => {
  // Reload the module boundary so each test owns fresh process-local caches.
  vi.resetModules();
  ({ getPackageBundleSize } = await import('./packageBundleSize'));
});

const measurement = { name: 'widget', version: '1.0.0', size: 100, gzip: 50 };

describe('bundle evidence caching', () => {
  it.each([
    { status: 503, body: { message: 'Build unavailable' } },
    { status: 200, body: { ...measurement, version: '9.0.0' } },
  ])(
    'recovers from an unavailable or mismatched measurement without caching it ($status)',
    async ({ status, body }) => {
      let recovered = false;
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(recovered ? measurement : body, { status: recovered ? 200 : status }),
          ),
        ),
      );
      const load = () =>
        Effect.runPromise(
          getPackageBundleSize('widget', '1.0.0', '1.0.0').pipe(Effect.provideService(HttpClient.HttpClient, client)),
        );
      expect(await load()).toMatchObject({ from: { status: 'unavailable' }, to: { status: 'unavailable' } });
      recovered = true;
      expect(await load()).toMatchObject({
        from: { status: 'available', size: 100 },
        to: { status: 'available', gzip: 50 },
      });
    },
  );

  it('does not cancel a shared lookup when only one requesting caller is interrupted', async () => {
    const gate = Promise.withResolvers<void>();
    let started = 0;
    let interrupted = 0;
    const client = HttpClient.make((request) =>
      Effect.promise(async () => {
        started += 1;
        await gate.promise;
        return HttpClientResponse.fromWeb(request, Response.json(measurement));
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted += 1;
          }),
        ),
      ),
    );
    const request = getPackageBundleSize('widget', '1.0.0', '1.0.0').pipe(
      Effect.provideService(HttpClient.HttpClient, client),
    );
    const controller = new AbortController();
    const first = Effect.runPromise(request, { signal: controller.signal }).then(
      () => 'completed',
      () => 'interrupted',
    );
    const second = Effect.runPromise(request);
    try {
      await vi.waitFor(() => expect(started).toBe(1));
      controller.abort();
      expect(await first).toBe('interrupted');
      expect(interrupted).toBe(0);
    } finally {
      gate.resolve();
    }
    expect(await second).toMatchObject({
      from: { status: 'available', size: 100 },
      to: { status: 'available', size: 100 },
    });
    expect(started).toBe(1);
  });
});
