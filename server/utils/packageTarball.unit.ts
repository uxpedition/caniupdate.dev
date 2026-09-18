import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { Effect } from 'effect';
import { pack, type Header } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegistryVersionManifest } from '../../shared/package.defs';
import type { PackageTarball } from '../../shared/tarball.defs';

type GetPackageTarball = (manifest: RegistryVersionManifest) => Effect.Effect<PackageTarball>;

let getPackageTarball: GetPackageTarball;

async function archive(entries: { name: string; body?: string; type?: Header['type']; linkname?: string }[]) {
  const output = pack();
  const chunks: Buffer[] = [];
  const reading = (async () => {
    for await (const chunk of output) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture chunk');
      chunks.push(chunk);
    }
  })();
  for (const { body = '', ...header } of entries) output.entry(header, body);
  output.finalize();
  await reading;
  return gzipSync(Buffer.concat(chunks));
}

function manifest(body: Buffer, version = '1.0.0') {
  return {
    name: 'widget',
    version,
    dist: {
      tarball: `https://registry.npmjs.org/widget/-/widget-${version}.tgz`,
      shasum: createHash('sha1').update(body).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    },
  };
}

const respond = (body: Buffer) => new Response(new Uint8Array(body));

beforeEach(async () => {
  // Reload the module boundary intentionally so each test gets fresh process-local caches.
  vi.resetModules();
  ({ getPackageTarball } = await import('./packageTarball'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function getPair(from: RegistryVersionManifest, to: RegistryVersionManifest) {
  return Effect.all({ from: getPackageTarball(from), to: getPackageTarball(to) }, { concurrency: 2 });
}

describe('published tarball evidence', () => {
  it('starts both downloads before either finishes and inspects bytes without executing scripts', async () => {
    const body = await archive([
      { name: 'package/index.js', body: 'throw new Error("must not execute");' },
      { name: 'package/docs/CHANGELOG.md', body: '# Changes\nPublished fixes' },
    ]);
    const gate = Promise.withResolvers<void>();
    const started: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        started.push(String(url));
        await gate.promise;
        return respond(body);
      }),
    );
    const pending = Effect.runPromise(getPair(manifest(body), manifest(body, '2.0.0')));
    try {
      await vi.waitFor(() => expect(started).toHaveLength(2));
    } finally {
      gate.resolve();
    }
    const result = await pending;
    expect(result.from).toMatchObject({
      status: 'available',

      changelogs: [{ path: 'docs/CHANGELOG.md', body: '# Changes\nPublished fixes', truncated: false }],
    });
    expect(result.from.files).toContainEqual({
      path: 'index.js',
      type: 'file',
      size: 36,
      sha256: createHash('sha256').update('throw new Error("must not execute");').digest('hex'),
    });
    expect(result.to.files).toEqual(result.from.files);
  });

  it('discards untrusted bytes on integrity mismatch while preserving the other version', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    const bad = manifest(body);
    bad.dist.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPair(bad, manifest(body, '2.0.0')));
    expect(result.from).toMatchObject({ status: 'unavailable', files: [], changelogs: [] });
    expect(result.to).toMatchObject({ status: 'available', files: [{ path: 'index.js', size: 4 }] });
  });

  it.each([
    [{ name: 'package/../escape', body: 'bad' }],
    [{ name: 'package/link', type: 'symlink' as const, linkname: '../../escape' }],
    [
      { name: 'package/a', body: 'one' },
      { name: 'package/a', body: 'two' },
    ],
  ])('rejects unsafe or ambiguous archive paths: %j', async (...entries) => {
    const body = await archive(entries);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [] });
  });

  it('rejects non-registry URLs before making requests', async () => {
    const body = await archive([]);
    const bad = manifest(body);
    bad.dist.tarball = 'https://127.0.0.1/private';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await Effect.runPromise(getPackageTarball(bad));
    expect(result.status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed archives even when their digest matches', async () => {
    const body = gzipSync(Buffer.from('not a tar archive'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [] });
  });

  it('rejects a bad tar header checksum despite matching registry integrity', async () => {
    const unpacked = gunzipSync(await archive([{ name: 'package/index.js', body: 'ok' }]));
    unpacked[0] = 0;
    const body = gzipSync(unpacked);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [], changelogs: [] });
  });

  it('bounds decompression instead of trusting the compressed size', async () => {
    const body = gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [] });
  });

  it('cancels a streamed response when the actual download exceeds the limit', async () => {
    const body = await archive([]);
    let cancelled = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024));
              },
              cancel() {
                cancelled++;
              },
            }),
          ),
      ),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [] });
    expect(cancelled).toBe(1);
  });

  it('times out and aborts a stalled response body without discarding the successful version', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'ok' }]);
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes('2.0.0')) return respond(body);
        return new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  controller.error(new Error('Aborted'));
                },
                { once: true },
              );
            },
          }),
        );
      }),
    );
    const result = await Effect.runPromise(getPair(manifest(body), manifest(body, '2.0.0')));
    expect(result.from.status).toBe('unavailable');
    expect(result.to.status).toBe('available');
    expect(aborted).toBe(true);
  }, 15_000);

  it('rejects excessive entry counts rather than returning an apparently complete inventory', async () => {
    const body = await archive(Array.from({ length: 10_001 }, (_, i) => ({ name: `package/${i}` })));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({ status: 'unavailable', files: [] });
  });

  it('inspects PAX long paths and records safe links without following them', async () => {
    const path = `docs/${'long-directory/'.repeat(20)}HISTORY`;
    const body = await archive([
      { name: `package/${path}`, body: 'Published history' },
      { name: 'package/current', type: 'symlink', linkname: path },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(body)),
    );
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(result).toMatchObject({
      status: 'available',
      changelogs: [{ path, body: 'Published history', truncated: false }],
    });
    expect(result.files).toContainEqual({
      path: 'current',
      type: 'symlink',
      size: 0,
      sha256: null,
      linkTarget: path,
    });
  });

  it('marks truncated changelog text partial without dropping the file inventory', async () => {
    const body = await archive([{ name: 'package/HISTORY.txt', body: 'a'.repeat(256 * 1024 + 1) }]);
    const fetcher = vi.fn(async () => respond(body));
    vi.stubGlobal('fetch', fetcher);
    const result = await Effect.runPromise(getPackageTarball(manifest(body)));
    const repeated = await Effect.runPromise(getPackageTarball(manifest(body)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repeated.status).toBe('partial');
    expect(result.status).toBe('partial');
    expect(result.changelogs[0]?.truncated).toBe(true);
    expect(result.changelogs[0]?.body).toHaveLength(256 * 1024);
    expect(result.files[0]?.size).toBe(256 * 1024 + 1);
  });
});

describe('published tarball cache', () => {
  it('shares an in-flight inspection and reuses its successful result', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    const gate = Promise.withResolvers<void>();
    const fetcher = vi.fn(async () => {
      await gate.promise;
      return respond(body);
    });
    vi.stubGlobal('fetch', fetcher);
    const version = manifest(body);

    const first = Effect.runPromise(getPackageTarball(version));
    const second = Effect.runPromise(getPackageTarball(version));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    gate.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe('available');
    expect(secondResult.status).toBe('available');
    await Effect.runPromise(getPackageTarball(version));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a good result for changed verification metadata or an unsafe URL', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    const fetcher = vi.fn(async () => respond(body));
    vi.stubGlobal('fetch', fetcher);
    const version = manifest(body);

    const first = await Effect.runPromise(getPackageTarball(version));
    expect(first.status).toBe('available');

    const changedIntegrity = manifest(body);
    changedIntegrity.dist.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
    const rejected = await Effect.runPromise(getPackageTarball(changedIntegrity));
    expect(rejected.status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);

    const unsafeUrl = manifest(body);
    unsafeUrl.dist.tarball = 'https://127.0.0.1/private';
    const unsafe = await Effect.runPromise(getPackageTarball(unsafeUrl));
    expect(unsafe.status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);

    const reused = await Effect.runPromise(getPackageTarball(version));
    expect(reused.url).toBe(version.dist.tarball);
    expect(reused.status).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries a transient failed inspection instead of caching it', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary network failure');
      return respond(body);
    });
    vi.stubGlobal('fetch', fetcher);
    const version = manifest(body);

    const failed = await Effect.runPromise(getPackageTarball(version));
    expect(failed.status).toBe('unavailable');
    const recovered = await Effect.runPromise(getPackageTarball(version));
    expect(recovered.status).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expires successful inspections after 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    const fetcher = vi.fn(async () => respond(body));
    vi.stubGlobal('fetch', fetcher);
    const version = manifest(body);

    await Effect.runPromise(getPackageTarball(version));
    await Effect.runPromise(getPackageTarball(version));
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await Effect.runPromise(getPackageTarball(version));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest successful key after reaching capacity', async () => {
    const body = await archive([{ name: 'package/index.js', body: 'safe' }]);
    const fetcher = vi.fn(async () => respond(body));
    vi.stubGlobal('fetch', fetcher);

    for (let index = 1; index <= 17; index++) {
      await Effect.runPromise(getPackageTarball(manifest(body, `${index}.0.0`)));
    }
    expect(fetcher).toHaveBeenCalledTimes(17);

    await Effect.runPromise(getPackageTarball(manifest(body, '1.0.0')));
    expect(fetcher).toHaveBeenCalledTimes(18);
  });
});
