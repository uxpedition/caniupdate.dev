import { Buffer } from 'node:buffer';
import { createGunzip, type Gunzip } from 'node:zlib';

import { extract, type Extract as TarStreamExtract } from 'tar-stream';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const COMPRESSED_FEED_CHUNK_BYTES = 64 * 1024;
const ARCHIVE_TRAILER_BYTES = 1024;

type Outcome<T> = { ok: true; value: T } | { ok: false; cause: unknown };

type EventAdapter = {
  addDrain(listener: () => void): void;
  removeDrain(listener: () => void): void;
  addError(listener: (cause: unknown) => void): void;
  removeError(listener: (cause: unknown) => void): void;
  addClose(listener: () => void): void;
  removeClose(listener: () => void): void;
};

type ChunkWrite = (chunk: Buffer, callback: (cause?: Error | null) => void) => boolean;

export type TarParser = TarStreamExtract;
export type EntryInspector<T> = (parser: TarParser, signal: AbortSignal) => Promise<T>;

type PumpOutcomes<T> = {
  entries: Promise<Outcome<T>>;
  output: Promise<Outcome<void>>;
  feed: Promise<Outcome<void>>;
};

function toError(cause: unknown, fallback = 'Tarball stream failed'): Error {
  return cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : fallback);
}

type DestroyableStream = {
  destroy(error?: Error): unknown;
  listenerCount(event: 'error'): number;
};

function destroyStream(stream: DestroyableStream, error: Error | undefined): void {
  try {
    // Avoid emitting an error after a sibling pump detached its final listener.
    stream.destroy(error !== undefined && stream.listenerCount('error') > 0 ? error : undefined);
  } catch {
    // A stream can finish between the error path and cleanup; preserve the first cause.
  }
}

function destroyStreams(parser: TarParser, gunzip: Gunzip, cause?: unknown): void {
  const error = cause === undefined ? undefined : toError(cause);
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

class ChunkWriter {
  private readonly wait = Promise.withResolvers<void>();
  private settled = false;
  private writeFinished: boolean;
  private needsDrain = true;
  private sawDrain = false;

  constructor(
    private readonly write: ChunkWrite,
    private readonly events: EventAdapter,
    private readonly waitForWrite: boolean,
    private readonly closeMessage: string,
    private readonly signal: AbortSignal,
  ) {
    this.writeFinished = !waitForWrite;
  }

  run(chunk: Buffer): Promise<void> {
    this.attach();
    if (this.signal.aborted) {
      this.onAbort();
      return this.wait.promise;
    }
    try {
      this.needsDrain = !this.write(chunk, this.onWrite);
    } catch (cause) {
      this.finish(cause);
      return this.wait.promise;
    }
    this.maybeFinish();
    return this.wait.promise;
  }

  private attach(): void {
    this.events.addDrain(this.onDrain);
    this.events.addError(this.onError);
    this.events.addClose(this.onClose);
    this.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  private cleanup(): void {
    this.events.removeDrain(this.onDrain);
    this.events.removeError(this.onError);
    this.events.removeClose(this.onClose);
    this.signal.removeEventListener('abort', this.onAbort);
  }

  private finish(cause?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    if (cause === undefined) this.wait.resolve();
    else this.wait.reject(cause);
  }

  private maybeFinish(): void {
    if (this.writeFinished && (!this.needsDrain || this.sawDrain)) this.finish();
  }

  private onDrain = (): void => {
    this.sawDrain = true;
    this.maybeFinish();
  };

  private onWrite = (cause?: Error | null): void => {
    if (cause !== undefined && cause !== null) {
      this.finish(cause);
      return;
    }
    this.writeFinished = true;
    this.maybeFinish();
  };

  private onError = (cause: unknown): void => {
    this.finish(cause);
  };

  private onClose = (): void => {
    this.finish(new Error(this.closeMessage));
  };

  private onAbort = (): void => {
    this.finish(this.signal.reason ?? new Error('Tarball inspection aborted'));
  };
}

function writeParserChunk(parser: TarParser, chunk: Buffer, signal: AbortSignal): Promise<void> {
  if (parser.destroyed || !parser.writable) throw new Error('Tar parser is not writable');
  return new ChunkWriter(
    (input) => parser.write(input),
    parserEvents(parser),
    false,
    'Tar parser closed before draining',
    signal,
  ).run(chunk);
}

function writeGunzipChunk(gunzip: Gunzip, chunk: Buffer, signal: AbortSignal): Promise<void> {
  return new ChunkWriter(
    (input, callback) => gunzip.write(input, callback),
    gunzipEvents(gunzip),
    true,
    'Gunzip closed before consuming input',
    signal,
  ).run(chunk);
}

async function feedCompressed(gunzip: Gunzip, body: Buffer, signal: AbortSignal): Promise<void> {
  for (let offset = 0; offset < body.length; offset += COMPRESSED_FEED_CHUNK_BYTES) {
    signal.throwIfAborted();
    const end = Math.min(body.length, offset + COMPRESSED_FEED_CHUNK_BYTES);
    await writeGunzipChunk(gunzip, body.subarray(offset, end), signal);
  }
  signal.throwIfAborted();
  gunzip.end();
}

function requireBufferChunk(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (!(value instanceof Uint8Array)) throw new Error('Invalid tarball decompressed chunk');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
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

class GunzipConsumer {
  private readonly wait = Promise.withResolvers<void>();
  private readonly tail = Buffer.allocUnsafe(ARCHIVE_TRAILER_BYTES);
  private tailLength = 0;
  private total = 0;
  private processing = false;
  private ended = false;
  private settled = false;

  constructor(
    private readonly gunzip: Gunzip,
    private readonly parser: TarParser,
    private readonly signal: AbortSignal,
  ) {}

  run(): Promise<void> {
    this.attach();
    if (this.signal.aborted) this.onAbort();
    return this.wait.promise;
  }

  private attach(): void {
    this.gunzip.on('data', this.onData);
    this.gunzip.once('end', this.onEnd);
    this.gunzip.once('error', this.onError);
    this.gunzip.once('close', this.onClose);
    this.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  private cleanup(): void {
    this.gunzip.removeListener('data', this.onData);
    this.gunzip.removeListener('end', this.onEnd);
    this.gunzip.removeListener('error', this.onError);
    this.gunzip.removeListener('close', this.onClose);
    this.signal.removeEventListener('abort', this.onAbort);
  }

  private finish(cause?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    if (cause === undefined) this.wait.resolve();
    else this.wait.reject(cause);
  }

  private fail = (cause: unknown): void => {
    if (this.settled) return;
    try {
      // The promise retains the first cause; avoid a second async error during teardown.
      this.gunzip.destroy();
    } catch {
      // Preserve the decompressor error that caused teardown.
    }
    this.finish(cause);
  };

  private maybeFinish(): void {
    if (!this.ended || this.processing || this.settled) return;
    try {
      inspectArchiveTrailer(this.total, this.tail, this.tailLength);
      this.finish();
    } catch (cause) {
      this.fail(cause);
    }
  }

  private onData = (rawChunk: unknown): void => {
    if (this.settled) return;
    try {
      this.gunzip.pause();
      this.processing = true;
    } catch (cause) {
      this.fail(cause);
      return;
    }
    void Promise.resolve()
      .then(() => this.process(rawChunk))
      .then(this.complete, this.fail);
  };

  private async process(rawChunk: unknown): Promise<void> {
    this.signal.throwIfAborted();
    const chunk = requireBufferChunk(rawChunk);
    const nextTotal = this.total + chunk.length;
    if (nextTotal > MAX_ARCHIVE_BYTES) throw new Error('Tarball exceeds archive byte limit');
    this.total = nextTotal;
    this.tailLength = retainTail(this.tail, this.tailLength, chunk);
    await writeParserChunk(this.parser, chunk, this.signal);
  }

  private complete = (): void => {
    try {
      this.processing = false;
      if (!this.ended && !this.settled) this.gunzip.resume();
      this.maybeFinish();
    } catch (cause) {
      this.processing = false;
      this.fail(cause);
    }
  };

  private onEnd = (): void => {
    this.ended = true;
    this.maybeFinish();
  };

  private onError = (cause: unknown): void => {
    this.fail(cause);
  };

  private onClose = (): void => {
    if (!this.ended && !this.settled) this.fail(new Error('Gunzip closed before completing'));
  };

  private onAbort = (): void => {
    this.fail(this.signal.reason ?? new Error('Tarball inspection aborted'));
  };
}

function consumeGunzip(gunzip: Gunzip, parser: TarParser, signal: AbortSignal): Promise<void> {
  return new GunzipConsumer(gunzip, parser, signal).run();
}

function settlePump<T>(pump: Promise<T>, onFailure: (cause: unknown) => void): Promise<Outcome<T>> {
  return pump.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (cause): Outcome<T> => {
      onFailure(cause);
      return { ok: false, cause };
    },
  );
}

class TarballPump<T> {
  private readonly parser = extract();
  private readonly gunzip = createGunzip({
    chunkSize: COMPRESSED_FEED_CHUNK_BYTES,
    maxOutputLength: MAX_ARCHIVE_BYTES,
  });

  constructor(
    private readonly body: Buffer,
    private readonly signal: AbortSignal,
    private readonly inspectEntries: EntryInspector<T>,
  ) {}

  async run(): Promise<T> {
    const onAbort = () => destroyStreams(this.parser, this.gunzip);
    this.signal.addEventListener('abort', onAbort, { once: true });
    const outcomes = this.startPumps();
    let completed = false;
    let failureCause: unknown;
    try {
      const value = await this.complete(outcomes);
      completed = true;
      return value;
    } catch (cause) {
      failureCause = cause;
      throw cause;
    } finally {
      this.signal.removeEventListener('abort', onAbort);
      destroyStreams(this.parser, this.gunzip, completed ? undefined : failureCause);
      await Promise.all([outcomes.feed, outcomes.output, outcomes.entries]);
    }
  }

  private startPumps(): PumpOutcomes<T> {
    const teardown = (cause: unknown) => destroyStreams(this.parser, this.gunzip, cause);
    return {
      entries: settlePump(this.inspectEntries(this.parser, this.signal), teardown),
      output: settlePump(consumeGunzip(this.gunzip, this.parser, this.signal), teardown),
      feed: settlePump(feedCompressed(this.gunzip, this.body, this.signal), teardown),
    };
  }

  private async complete(outcomes: PumpOutcomes<T>): Promise<T> {
    const [feed, output] = await Promise.all([outcomes.feed, outcomes.output]);
    if (!output.ok) throw output.cause;
    if (!feed.ok) throw feed.cause;
    this.parser.end(undefined);
    const entries = await outcomes.entries;
    if (!entries.ok) throw entries.cause;
    return entries.value;
  }
}

export function inspectTarball<T>(body: Buffer, signal: AbortSignal, inspectEntries: EntryInspector<T>): Promise<T> {
  return new TarballPump(body, signal, inspectEntries).run();
}
