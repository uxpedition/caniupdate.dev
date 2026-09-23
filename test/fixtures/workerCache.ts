import { Cache, Effect, Exit } from 'effect';

// Test Worker for `server/utils/workerCache.unit.ts`. It imports the real `effect` package so the dependency patch in
// `patches/effect@4.0.0-rc.115.patch` is exercised under workerd, where cross-request promise safety is on.

type Env = {
  readonly UPSTREAM_ORIGIN: string;
};

/** Per-key count of `/value` requests that reached this worker, so the test can observe every waiter arrive. */
const arrivals: Record<string, number> = {};

// The upstream origin is only known at request time, so the module-level cache reads it lazily.
let upstreamOrigin = '';

/** One pending lookup per key, shared by every concurrent caller and backed by real outbound I/O. */
const cache = Effect.runSync(
  Cache.makeWith(
    (key: string) =>
      Effect.promise(async (signal) => {
        const response = await fetch(new URL(`/value?key=${encodeURIComponent(key)}`, upstreamOrigin), { signal });
        if (!response.ok) throw new Error(`upstream responded ${response.status}`);
        return await response.text();
      }),
    { capacity: 16, timeToLive: () => '1 minute' },
  ),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') ?? '';
    if (url.pathname === '/arrivals') return new Response(String(arrivals[key] ?? 0));
    if (url.pathname !== '/value') return new Response('not found', { status: 404 });

    upstreamOrigin = env.UPSTREAM_ORIGIN;
    arrivals[key] = (arrivals[key] ?? 0) + 1;

    // Cancelling one caller must leave the shared lookup alive for its other waiters.
    const exit = await Effect.runPromiseExit(Cache.get(cache, key), { signal: request.signal });
    if (Exit.isFailure(exit)) return new Response(String(exit.cause), { status: 500 });
    return new Response(exit.value, { status: 200 });
  },
};
