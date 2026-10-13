import { Buffer } from 'node:buffer';
import type { ReadableEventMap } from 'node:stream';
import { createGunzip, type Gunzip } from 'node:zlib';

import { Cause, Effect, Exit, Fiber, Queue, Scope, Stream } from 'effect';
import { extract, type Extract as TarStreamExtract } from 'tar-stream';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

const COMPRESSED_FEED_CHUNK_BYTES = 64 * 1024;

const ARCHIVE_TRAILER_BYTES = 1024;

type EventAdapter = {
  addDrain(listener: () => void): void;
  removeDrain(listener: () => void): void;
  addError(listener: (cause: unknown) => void): void;
  removeError(listener: (cause: unknown) => void): void;
  addClose(listener: () => void): void;
  removeClose(listener: () => void): void;
};

type ChunkWrite = (chunk: Buffer, callback?: (cause?: Error | null) => void) => boolean;

export type TarParser = TarStreamExtract;

export type EntryInspector<T> = (parser: TarParser, signal: AbortSignal) => Promise<T>;

type Streams = {
  parser: TarParser;
  gunzip: Gunzip;
  parserEvents: EventAdapter;
  gunzipEvents: EventAdapter;
};

type InspectionOutcome<T> = { ok: true; value: T } | { ok: false; cause: unknown };

type ReadinessSignal = { promise: Promise<void>; signal: () => void };

function readinessSignal(): ReadinessSignal {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, signal: () => resolve() };
}

const TARBALL_FAILURE_MESSAGE = 'Tarball inspection failed';

// Error instances keep identity; non-Error causes from Node or Effect boundaries are kept on `cause`.
export function toTarballError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(TARBALL_FAILURE_MESSAGE, { cause });
}

function destroyStream(
  stream: { destroy(error?: Error): void; listenerCount(event: 'error'): number },
  error?: Error,
): void {
  try {
    stream.destroy(error !== undefined && stream.listenerCount('error') > 0 ? error : undefined);
  } catch {
    // A stream can finish between the error path and cleanup; preserve the first cause.
  }
}

function destroyStreams({ parser, gunzip }: Streams, cause?: unknown): void {
  const error = cause === undefined ? undefined : toTarballError(cause);
  destroyStream(parser, error);
  destroyStream(gunzip, error);
}

function parserEvents(parser: TarParser): EventAdapter {
  return {
    addDrain: (listener) => parser.once('drain', listener),
    removeDrain: (listener) => parser.removeListener('drain', listener),
    addError: (listener) => parser.once('error', listener),
    removeError: (listener) => parser.removeListener('error', listener),
    addClose: (listener) => parser.once('close', listener),
    removeClose: (listener) => parser.removeListener('close', listener),
  };
}

function gunzipEvents(gunzip: Gunzip): EventAdapter {
  return {
    addDrain: (listener) => gunzip.once('drain', listener),
    removeDrain: (listener) => gunzip.removeListener('drain', listener),
    addError: (listener) => gunzip.once('error', listener),
    removeError: (listener) => gunzip.removeListener('error', listener),
    addClose: (listener) => gunzip.once('close', listener),
    removeClose: (listener) => gunzip.removeListener('close', listener),
  };
}

type ResumeWrite = (effect: Effect.Effect<void, Error>) => void;

class ChunkWriteWaiter {
  private settled = false;
  private writeFinished: boolean;
  private needsDrain = true;
  private sawDrain = false;

  constructor(
    private readonly events: EventAdapter,
    private readonly waitForWrite: boolean,
    private readonly closeMessage: string,
    private readonly resume: ResumeWrite,
  ) {
    this.writeFinished = !waitForWrite;
  }

  start(chunk: Buffer, write: ChunkWrite): void {
    this.events.addDrain(this.onDrain);
    this.events.addError(this.onError);
    this.events.addClose(this.onClose);

    try {
      this.needsDrain = !write(chunk, this.onWrite);
      this.maybeFinish();
    } catch (cause) {
      this.finish(cause);
    }
  }

  cleanup(): void {
    this.events.removeDrain(this.onDrain);
    this.events.removeError(this.onError);
    this.events.removeClose(this.onClose);
  }

  private finish(cause?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.resume(cause === undefined ? Effect.void : Effect.fail(toTarballError(cause)));
  }

  private maybeFinish(): void {
    if (this.writeFinished && (!this.needsDrain || this.sawDrain)) this.finish();
  }

  private readonly onDrain = (): void => {
    this.sawDrain = true;
    this.maybeFinish();
  };

  private readonly onWrite = (cause?: Error | null): void => {
    if (cause !== undefined && cause !== null) {
      this.finish(cause);

      return;
    }

    this.writeFinished = true;
    this.maybeFinish();
  };

  private readonly onError = (cause: unknown): void => this.finish(cause);
  private readonly onClose = (): void => this.finish(new Error(this.closeMessage));
}

function writeChunk(
  chunk: Buffer,
  write: ChunkWrite,
  events: EventAdapter,
  waitForWrite: boolean,
  closeMessage: string,
): Effect.Effect<void, Error> {
  return Effect.callback<void, Error>((resume) => {
    const waiter = new ChunkWriteWaiter(events, waitForWrite, closeMessage, resume);
    waiter.start(chunk, write);

    return Effect.sync(() => waiter.cleanup());
  });
}

function writeParserChunk(parser: TarParser, events: EventAdapter, chunk: Buffer): Effect.Effect<void, Error> {
  return Effect.suspend(() => {
    if (parser.destroyed || !parser.writable) return Effect.fail(new Error('Tar parser is not writable'));

    return writeChunk(chunk, (input) => parser.write(input), events, false, 'Tar parser closed before draining');
  });
}

function writeGunzipChunk(gunzip: Gunzip, events: EventAdapter, chunk: Buffer): Effect.Effect<void, Error> {
  return writeChunk(
    chunk,
    (input, callback) => gunzip.write(input, callback),
    events,
    true,
    'Gunzip closed before consuming input',
  );
}

function feedCompressed(gunzip: Gunzip, events: EventAdapter, body: Buffer): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    for (let offset = 0; offset < body.length; offset += COMPRESSED_FEED_CHUNK_BYTES) {
      const end = Math.min(body.length, offset + COMPRESSED_FEED_CHUNK_BYTES);
      yield* writeGunzipChunk(gunzip, events, body.subarray(offset, end));
    }

    yield* Effect.try({ try: () => gunzip.end(), catch: toTarballError });
  });
}

function asBufferChunk(chunk: Uint8Array): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;

  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function retainTail(tail: Buffer, tailLength: number, chunk: Buffer): number {
  if (chunk.length >= tail.length) {
    tail.set(chunk.subarray(chunk.length - tail.length));

    return tail.length;
  }

  const nextLength = Math.min(tail.length, tailLength + chunk.length);
  const retained = nextLength - chunk.length;

  if (retained > 0) tail.copyWithin(0, tailLength - retained, tailLength);
  tail.set(chunk, retained);

  return nextLength;
}

function inspectArchiveTrailer(total: number, tail: Buffer, tailLength: number): void {
  if (total < ARCHIVE_TRAILER_BYTES || total % 512 !== 0 || tailLength < ARCHIVE_TRAILER_BYTES) {
    throw new Error('Incomplete tarball archive');
  }

  for (let index = 0; index < ARCHIVE_TRAILER_BYTES; index++) {
    if (tail[index] !== 0) throw new Error('Incomplete tarball archive');
  }
}

// Gunzip's 'data' listener is untyped; non-binary output is rejected here, before it reaches the consumer.
function decompressedChunkListener(
  gunzip: Gunzip,
  queue: Queue.Enqueue<Buffer, Error>,
): (...args: ReadableEventMap['data']) => void {
  return (chunk) => {
    gunzip.pause();
    const value: unknown = chunk;

    if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      Queue.failCauseUnsafe(queue, Cause.fail(new Error('Invalid tarball decompressed chunk')));

      return;
    }

    if (!Queue.offerUnsafe(queue, asBufferChunk(value))) {
      Queue.failCauseUnsafe(queue, Cause.fail(new Error('Gunzip output queue overflow')));
    }
  };
}

function decompressedChunks(gunzip: Gunzip, signalReady: () => void): Stream.Stream<Buffer, Error> {
  return Stream.callback<Buffer, Error>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          let ended = false;

          const onData = decompressedChunkListener(gunzip, queue);

          const onEnd = () => {
            ended = true;
            Queue.endUnsafe(queue);
          };

          const onError = (cause: unknown) => Queue.failCauseUnsafe(queue, Cause.fail(toTarballError(cause)));

          const onClose = () => {
            if (!ended) Queue.failCauseUnsafe(queue, Cause.fail(new Error('Gunzip closed before completing')));
          };

          gunzip.on('data', onData);
          gunzip.once('end', onEnd);
          gunzip.on('error', onError);
          gunzip.once('close', onClose);
          signalReady();

          return () => {
            gunzip.removeListener('data', onData);
            gunzip.removeListener('end', onEnd);
            gunzip.removeListener('error', onError);
            gunzip.removeListener('close', onClose);
          };
        }),
        (cleanup) => Effect.sync(cleanup),
      ),
    { bufferSize: 1 },
  );
}

function consumeGunzip(
  gunzip: Gunzip,
  parser: TarParser,
  events: EventAdapter,
  signalReady: () => void,
): Effect.Effect<void, Error> {
  const tail = Buffer.allocUnsafe(ARCHIVE_TRAILER_BYTES);
  let tailLength = 0;
  let total = 0;

  return Effect.gen(function* () {
    yield* Stream.runForEach(decompressedChunks(gunzip, signalReady), (chunk) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => {
            const nextTotal = total + chunk.length;

            if (nextTotal > MAX_ARCHIVE_BYTES) throw new Error('Tarball exceeds archive byte limit');
            total = nextTotal;
            tailLength = retainTail(tail, tailLength, chunk);
          },
          catch: toTarballError,
        });

        yield* writeParserChunk(parser, events, chunk);
        yield* Effect.try({ try: () => gunzip.resume(), catch: toTarballError });
      }),
    );
    yield* Effect.try({ try: () => inspectArchiveTrailer(total, tail, tailLength), catch: toTarballError });
  });
}

function teardownOnFailure<A, E>(streams: Streams): (exit: Exit.Exit<A, E>) => Effect.Effect<void> {
  return (exit) => {
    if (!Exit.isFailure(exit)) return Effect.void;
    const cause = Cause.hasFails(exit.cause) || Cause.hasDies(exit.cause) ? Cause.squash(exit.cause) : undefined;

    return Effect.sync(() => destroyStreams(streams, cause));
  };
}

function startGunzipConsumer(streams: Streams): Effect.Effect<Fiber.Fiber<void, Error>, Error, Scope.Scope> {
  const { parser, gunzip, parserEvents } = streams;
  const consumerReady = readinessSignal();
  let outputExit: Exit.Exit<void, Error> | undefined;

  const outputTask = Effect.onExit(
    Effect.onExit(consumeGunzip(gunzip, parser, parserEvents, consumerReady.signal), teardownOnFailure(streams)),
    (exit) =>
      Effect.sync(() => {
        outputExit = exit;
        consumerReady.signal();
      }),
  );

  return Effect.gen(function* () {
    const fiber: Fiber.Fiber<void, Error> = yield* Effect.forkScoped(outputTask);
    // Attach decompressor output listeners before any input can trigger an error or be lost.
    yield* Effect.promise(() => consumerReady.promise);

    if (outputExit !== undefined && Exit.isFailure(outputExit)) return yield* Effect.failCause(outputExit.cause);

    return fiber;
  });
}

function inspectEntriesEffect<T>(
  streams: Streams,
  inspectEntries: EntryInspector<T>,
  signalReady: () => void,
): Effect.Effect<T, Error> {
  return Effect.callback<T, Error>((resume, signal) => {
    let pending: Promise<T>;

    try {
      pending = inspectEntries(streams.parser, signal);
    } catch (cause) {
      pending = Promise.reject(cause);
    }

    const settled: Promise<InspectionOutcome<T>> = pending.then(
      (value): InspectionOutcome<T> => ({ ok: true, value }),
      (cause): InspectionOutcome<T> => ({ ok: false, cause }),
    );

    signalReady();
    void settled.then((outcome) =>
      resume(outcome.ok ? Effect.succeed(outcome.value) : Effect.fail(toTarballError(outcome.cause))),
    );

    return Effect.gen(function* () {
      yield* Effect.sync(() => destroyStreams(streams));
      yield* Effect.promise(() => settled.then(() => undefined));
    });
  });
}

function complete<T>(
  streams: Streams,
  body: Buffer,
  inspectEntries: EntryInspector<T>,
): Effect.Effect<T, Error, Scope.Scope> {
  const { parser, gunzip, gunzipEvents } = streams;

  return Effect.gen(function* () {
    const outputFiber = yield* startGunzipConsumer(streams);
    const inspectionReady = readinessSignal();

    const entryTask = Effect.onExit(
      inspectEntriesEffect(streams, inspectEntries, inspectionReady.signal),
      teardownOnFailure(streams),
    );

    const entries: Fiber.Fiber<T, Error> = yield* Effect.forkScoped(entryTask);
    // Register the parser iterator while it is live; a malformed first gzip chunk can close it.
    yield* Effect.promise(() => inspectionReady.promise);

    const feed = yield* Effect.exit(
      feedCompressed(gunzip, gunzipEvents, body).pipe(Effect.onExit(teardownOnFailure(streams))),
    );

    const output = yield* Fiber.join(outputFiber).pipe(Effect.exit);

    if (Exit.isFailure(output)) return yield* Effect.failCause(output.cause);

    if (Exit.isFailure(feed)) return yield* Effect.failCause(feed.cause);

    yield* Effect.try({ try: () => parser.end(undefined), catch: toTarballError });
    const entryExit = yield* Fiber.join(entries).pipe(Effect.exit);

    if (Exit.isFailure(entryExit)) return yield* Effect.failCause(entryExit.cause);

    return entryExit.value;
  });
}

export function inspectTarball<T>(body: Buffer, inspectEntries: EntryInspector<T>): Effect.Effect<T, Error> {
  return Effect.scoped(
    Effect.gen(function* () {
      const streams = yield* Effect.acquireRelease(
        Effect.try({
          try: (): Streams => {
            const parser = extract();

            const gunzip = createGunzip({
              chunkSize: COMPRESSED_FEED_CHUNK_BYTES,
              maxOutputLength: MAX_ARCHIVE_BYTES,
            });

            return { parser, gunzip, parserEvents: parserEvents(parser), gunzipEvents: gunzipEvents(gunzip) };
          },
          catch: toTarballError,
        }),
        (streams) => Effect.sync(() => destroyStreams(streams)),
      );

      return yield* complete(streams, body, inspectEntries);
    }),
  );
}
