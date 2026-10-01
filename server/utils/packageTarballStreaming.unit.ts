import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

import { Effect, Fiber } from 'effect';
import { pack } from 'tar-stream';
import { describe, expect, it, vi } from 'vitest';

import { inspectTarball } from './packageTarballStreaming';

async function archiveWithEntry(body: Buffer): Promise<Buffer> {
  const output = pack();
  const chunks: Buffer[] = [];
  const reading = (async () => {
    for await (const chunk of output) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture chunk');
      chunks.push(chunk);
    }
  })();
  output.entry({ name: 'package/payload', size: body.length }, body);
  output.finalize();
  await reading;
  return gzipSync(Buffer.concat(chunks));
}

function runInspection<T, E>(inspection: Effect.Effect<T, E>) {
  if (!Effect.isEffect(inspection)) {
    void Promise.resolve(inspection).catch(() => undefined);
    throw new Error('Tarball inspection must return an Effect');
  }
  return Effect.runFork(inspection);
}

describe('tarball inspection lifecycle', () => {
  it('registers entry inspection before malformed gzip can close the parser', async () => {
    const body = Buffer.from('not gzip');
    let startedWithLiveParser = false;
    const outcome = await Effect.runPromiseExit(
      inspectTarball(body, async (parser) => {
        startedWithLiveParser = !parser.destroyed;
        return undefined;
      }),
    );

    expect(startedWithLiveParser).toBe(true);
    expect(outcome._tag).toBe('Failure');
  });

  it('inspects a populated archive successfully', async () => {
    const body = await archiveWithEntry(Buffer.from('payload'));
    const entries = await Effect.runPromise(
      inspectTarball(body, async (parser) => {
        const names: string[] = [];
        for await (const entry of parser) {
          names.push(entry.header.name);
          for await (const chunk of entry) void chunk;
        }
        return names;
      }),
    );

    expect(entries).toEqual(['package/payload']);
  });

  it('joins failed inspection cleanup after reading a populated archive', async () => {
    const body = await archiveWithEntry(Buffer.from('payload'));
    const cleanupGate = Promise.withResolvers<void>();
    let cleanupStarted = false;
    let inspectorSettled = false;
    const outcome = Effect.runPromise(
      inspectTarball(body, async (parser) => {
        try {
          for await (const entry of parser) {
            for await (const chunk of entry) void chunk;
          }
          throw new Error('Inspection failed after reading the archive');
        } finally {
          cleanupStarted = true;
          await cleanupGate.promise;
          inspectorSettled = true;
        }
      }),
    ).then(
      () => ({ ok: true as const }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );

    try {
      await vi.waitFor(() => expect(cleanupStarted).toBe(true));
      expect(inspectorSettled).toBe(false);
    } finally {
      cleanupGate.resolve();
    }
    expect((await outcome).ok).toBe(false);
    expect(inspectorSettled).toBe(true);
  });

  it('interrupts and joins in-flight entry inspection before returning', async () => {
    const body = await archiveWithEntry(Buffer.alloc(4 * 1024 * 1024));
    let started = false;
    let signalAborted = false;
    let cleanupStarted = false;
    let inspectorSettled = false;
    let interruptionFinished = false;
    let interruptedAfterCleanup = false;
    const cleanupGate = Promise.withResolvers<void>();

    const fiber = runInspection(
      inspectTarball(body, async (_parser, signal) => {
        started = true;
        try {
          await new Promise<never>((_resolve, reject) => {
            if (signal.aborted) {
              signalAborted = true;
              reject(signal.reason);
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                signalAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
          throw new Error('Inspection unexpectedly completed');
        } finally {
          cleanupStarted = true;
          await cleanupGate.promise;
          inspectorSettled = true;
        }
      }),
    );

    await vi.waitFor(() => expect(started).toBe(true));
    const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interruptionFinished = true;
    });
    try {
      await vi.waitFor(() => expect(cleanupStarted).toBe(true));
      interruptedAfterCleanup = !interruptionFinished;
    } finally {
      cleanupGate.resolve();
    }
    await interruption;

    expect(signalAborted).toBe(true);
    expect(interruptedAfterCleanup).toBe(true);
    expect(inspectorSettled).toBe(true);
  });
});
