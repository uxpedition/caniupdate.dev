import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

import { Effect, Fiber } from 'effect';
import { pack } from 'tar-stream';
import { describe, expect, it, vi } from 'vitest';

import { inspectTarball } from './packageTarballStreaming';

async function archiveWithLargeEntry(): Promise<Buffer> {
  const output = pack();
  const chunks: Buffer[] = [];
  const reading = (async () => {
    for await (const chunk of output) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid fixture chunk');
      chunks.push(chunk);
    }
  })();
  output.entry({ name: 'package/payload', size: 4 * 1024 * 1024 }, Buffer.alloc(4 * 1024 * 1024));
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
  it('interrupts and joins in-flight entry inspection before returning', async () => {
    const body = await archiveWithLargeEntry();
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
