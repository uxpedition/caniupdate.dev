import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { unstable_dev, type Unstable_DevOptions, type Unstable_DevWorker } from 'wrangler';

// Regression for `patches/effect@4.0.0-rc.115.patch`. Cache entries that await a shared in-flight lookup used to join
// the lookup fiber; workerd canceled waiters as hung and warned about cross-request promise resolution. The temporary
// config below keeps cross-request promise safety enabled, because disabling it would hide the bug.
const FIXTURE = fileURLToPath(new URL('../../test/fixtures/workerCache.ts', import.meta.url));

type Upstream = {
  readonly origin: string;
  readonly calls: string[];
  hold: () => void;
  release: () => void;
  close: () => Promise<void>;
};

/** Hold every upstream response behind a gate so workerd has real pending I/O instead of a fast local answer. */
async function startUpstream(): Promise<Upstream> {
  let gate = Promise.withResolvers<void>();
  const calls: string[] = [];
  const server = createServer((request, response) => {
    const key = new URL(request.url ?? '/', 'http://upstream').searchParams.get('key') ?? '';
    calls.push(key);
    void gate.promise.then(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ key, value: `value-${key}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('upstream server did not bind a port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    calls,
    // A fresh gate per test, so one test's release cannot unblock the next test's upstream response.
    hold: () => {
      gate = Promise.withResolvers<void>();
    },
    release: () => {
      gate.resolve();
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

let directory: string | undefined;
let worker: Unstable_DevWorker | undefined;
let upstream: Upstream | undefined;

function dev(): Unstable_DevWorker {
  if (worker === undefined) throw new Error('workerd did not start');
  return worker;
}

function origin(): Upstream {
  if (upstream === undefined) throw new Error('upstream did not start');
  return upstream;
}

async function arrivalsFor(key: string): Promise<number> {
  const response = await dev().fetch(`/arrivals?key=${key}`);
  return Number(await response.text());
}

describe('Effect Cache pending waiters under workerd', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'worker-cache-'));
    upstream = await startUpstream();
    const config = join(directory, 'wrangler.json');
    await writeFile(
      config,
      JSON.stringify({
        name: 'worker-cache-regression',
        compatibility_date: '2026-09-16',
        compatibility_flags: ['nodejs_compat'],
        vars: { UPSTREAM_ORIGIN: upstream.origin },
        send_metrics: false,
      }),
    );
    const options: Unstable_DevOptions = {
      config,
      local: true,
      port: 0,
      inspectorPort: 0,
      persist: false,
      experimental: { watch: false, disableDevRegistry: true, disableExperimentalWarning: true },
    };
    worker = await unstable_dev(FIXTURE, options);
  }, 120_000);

  beforeEach(() => {
    // The cache lives in the worker isolate for the whole suite, so every test uses its own key.
    origin().hold();
    origin().calls.length = 0;
  });

  afterAll(async () => {
    // Never leave a held upstream response behind: workerd teardown waits for its outbound requests.
    upstream?.release();
    await worker?.stop();
    await upstream?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }, 60_000);

  it('answers four concurrent requests for one key from a single upstream lookup', async () => {
    const key = 'concurrent';
    const pending = Array.from({ length: 4 }, () => dev().fetch(`/value?key=${key}`));
    try {
      await vi.waitFor(
        async () => {
          expect(await arrivalsFor(key)).toBe(4);
          expect(origin().calls).toEqual([key]);
        },
        { timeout: 30_000 },
      );
    } finally {
      origin().release();
    }

    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const expected = { key, value: `value-${key}` };
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies).toEqual([expected, expected, expected, expected]);
    expect(origin().calls).toEqual([key]);
  }, 60_000);

  it('keeps the shared lookup for a waiting caller when the initiating caller is cancelled', async () => {
    const key = 'cancelled';
    const controller = new AbortController();
    try {
      const initiator = dev().fetch(`/value?key=${key}`, { signal: controller.signal });
      await vi.waitFor(() => expect(origin().calls).toEqual([key]), { timeout: 30_000 });

      const follower = dev().fetch(`/value?key=${key}`);
      await vi.waitFor(
        async () => {
          expect(await arrivalsFor(key)).toBe(2);
          expect(origin().calls).toEqual([key]);
        },
        { timeout: 30_000 },
      );

      controller.abort();
      await expect(initiator).rejects.toMatchObject({ name: 'AbortError' });

      origin().release();
      const response = await follower;
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ key, value: `value-${key}` });
      expect(origin().calls).toEqual([key]);
    } finally {
      origin().release();
    }
  }, 60_000);
});
