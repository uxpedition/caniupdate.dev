import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual, type Hash } from 'node:crypto';
import { posix } from 'node:path';

import { Effect } from 'effect';
import { type Header } from 'tar-stream';

import type { PackageTarball, PublishedFile, ShippedChangelog } from '../../../shared/comparison/evidence/tarball.defs';
import type { RegistryVersionManifest } from '../../../shared/comparison/package/package.defs';
import { inspectTarball, toTarballError, type TarParser } from './tarballStreaming';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

const MAX_ENTRIES = 10_000;

const MAX_CHANGELOG_BYTES = 256 * 1024;

const MAX_CHANGELOG_TOTAL_BYTES = 1024 * 1024;

const TIMEOUT_MS = 10_000;

const CHANGELOG_NAME = /^(changelog|changes|history)(\.(md|markdown|txt|rst))?$/i;

type InspectedTarball = Omit<PackageTarball, 'url'>;

type InspectionResult = Omit<InspectedTarball, 'status'>;

type Outcome<T> = { ok: true; value: T } | { ok: false; cause: unknown };

type ContentResult = {
  text: Buffer;
  sha256: string | null;
};

type TarEntry = AsyncIterable<unknown> & { header: Header };

type EntryResult = {
  file: PublishedFile;
  text: Buffer;
  isChangelog: boolean;
};

type EntryInspectionState = {
  packageRoot: string;
  archiveRoot: string | undefined;
  files: PublishedFile[];
  changelogs: ShippedChangelog[];
  paths: Set<string>;
  reasons: Set<string>;
  tasks: Array<Promise<Outcome<EntryResult>>>;
  changelogBytes: number;
  firstTaskFailure: unknown;
};

function verifyIntegrity(body: Buffer, dist: Pick<RegistryVersionManifest['dist'], 'integrity' | 'shasum'>): void {
  if (dist.integrity !== undefined) {
    // SRI requires the strongest supported algorithm; never downgrade to shasum on failure.
    const tokens = dist.integrity.trim().split(/\s+/);

    for (const algorithm of ['sha512', 'sha384', 'sha256']) {
      const candidates = tokens.filter((token) => token.startsWith(`${algorithm}-`));

      if (candidates.length === 0) continue;
      const digest = createHash(algorithm).update(body).digest();

      if (
        candidates.some((token) => {
          const encoded = token.slice(algorithm.length + 1);

          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
          const expected = Buffer.from(encoded, 'base64');

          return expected.length === digest.length && timingSafeEqual(expected, digest);
        })
      )
        return;
      throw new Error('Tarball integrity mismatch');
    }

    throw new Error('Unsupported or malformed tarball integrity');
  }

  if (
    !/^[a-f0-9]{40}$/i.test(dist.shasum) ||
    createHash('sha1').update(body).digest('hex') !== dist.shasum.toLowerCase()
  ) {
    throw new Error('Tarball shasum mismatch');
  }
}

function normalizeSafeTarballUrl(url: string): string {
  const parsed = new URL(url);

  if (parsed.origin !== 'https://registry.npmjs.org' || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Tarball URL must use the public npm HTTPS registry');
  }

  return parsed.href;
}

async function downloadTarball(url: string, signal: AbortSignal): Promise<Buffer> {
  // workerd supports manual redirects; the status check below rejects them without following Location.
  const response = await fetch(normalizeSafeTarballUrl(url), { signal, redirect: 'manual' });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Tarball request failed');
  }

  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body.cancel();
    throw new Error('Tarball exceeds download byte limit');
  }

  return readTarballBody(response.body, signal);
}

async function readTarballBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();

      if (done) break;
      size += value.byteLength;

      if (size > MAX_DOWNLOAD_BYTES) throw new Error('Tarball exceeds download byte limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  return Buffer.concat(chunks, size);
}

function hasUnsafePathCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code < 32 || code === 127 || code === 92) return true;
  }

  return false;
}

function archivePath(name: string, directory: boolean, root: string): string {
  const path = directory && name.endsWith('/') ? name.slice(0, -1) : name;

  if (
    path.length > 4096 ||
    hasUnsafePathCharacters(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    (path !== root && !path.startsWith(`${root}/`))
  ) {
    throw new Error('Unsafe or unsupported tarball path');
  }

  if (path === root && !directory) throw new Error('Invalid tarball root');

  return path.slice(root.length + 1);
}

function archiveRoot(name: string, state: EntryInspectionState): string {
  const root = state.archiveRoot ?? name.split('/')[0] ?? '';

  if (root !== 'package' && root !== state.packageRoot) throw new Error('Unsupported tarball root');

  return root;
}

function inspectHeader(header: Header, state: EntryInspectionState): PublishedFile {
  const { type, size } = header;

  if (type !== 'file' && type !== 'directory' && type !== 'symlink' && type !== 'link') {
    throw new Error('Unsupported tarball entry type');
  }

  validateEntrySize(header);
  const root = archiveRoot(header.name, state);
  const file: PublishedFile = { path: archivePath(header.name, type === 'directory', root), type, size, sha256: null };
  state.archiveRoot = root;

  if (type === 'link' || type === 'symlink') return { ...file, linkTarget: inspectLink(header, root) };

  return file;
}

function validateEntrySize({ size, type }: Header): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid tarball entry size');
  }

  if (type !== 'file' && size !== 0) throw new Error('Invalid non-file tarball entry size');
}

function inspectLink(header: Header, root: string): string {
  const target = header.linkname;

  if (!target || target.length > 4096 || posix.isAbsolute(target) || hasUnsafePathCharacters(target)) {
    throw new Error('Unsafe tarball link');
  }

  // Hardlinks are archive-root-relative; symlinks are relative to their containing directory.
  const resolved = header.type === 'link' ? target : posix.join(posix.dirname(header.name), target);
  archivePath(resolved, false, root);

  return target;
}

type ContentState = {
  hash: Hash | null;
  text: Buffer[];
  captured: number;
  actual: number;
  allowance: number;
};

function consumeContentChunk(chunk: Buffer, state: ContentState, signal: AbortSignal): void {
  signal.throwIfAborted();
  state.actual += chunk.length;
  state.hash?.update(chunk);

  if (state.captured >= state.allowance) return;
  const part = chunk.subarray(0, state.allowance - state.captured);
  state.text.push(part);
  state.captured += part.length;
}

async function inspectContent(
  entry: AsyncIterable<unknown>,
  file: PublishedFile,
  allowance: number,
  signal: AbortSignal,
): Promise<ContentResult> {
  const state: ContentState = {
    hash: file.type === 'file' ? createHash('sha256') : null,
    text: [],
    captured: 0,
    actual: 0,
    allowance,
  };

  for await (const value of entry) {
    if (!Buffer.isBuffer(value)) throw new Error('Invalid tarball content chunk');

    consumeContentChunk(value, state, signal);
  }

  if (state.actual !== file.size) throw new Error('Incomplete tarball entry');

  return { text: Buffer.concat(state.text, state.captured), sha256: state.hash?.digest('hex') ?? null };
}

function decodeChangelog(file: PublishedFile, text: Buffer, reasons: Set<string>): ShippedChangelog | null {
  const truncated = text.length < file.size;

  if (truncated) reasons.add('Shipped changelog text exceeded inspection limits');

  try {
    // Streaming decode drops an incomplete trailing UTF-8 sequence only when deliberately truncated.
    const body = new TextDecoder('utf-8', { fatal: true }).decode(text, { stream: truncated });

    return { path: file.path, body, truncated };
  } catch {
    reasons.add('A shipped changelog was not valid UTF-8 text');

    return null;
  }
}

function createEntryState(packageRoot: string): EntryInspectionState {
  return {
    packageRoot,
    archiveRoot: undefined,
    files: [],
    changelogs: [],
    paths: new Set<string>(),
    reasons: new Set<string>(),
    tasks: [],
    changelogBytes: 0,
    firstTaskFailure: undefined,
  };
}

function changelogAllowance(file: PublishedFile, isChangelog: boolean, reserved: number): number {
  if (!isChangelog) return 0;

  return Math.min(MAX_CHANGELOG_BYTES, MAX_CHANGELOG_TOTAL_BYTES - reserved, file.size);
}

function inspectEntry(
  entry: TarEntry,
  state: EntryInspectionState,
  parser: TarParser,
  signal: AbortSignal,
): Promise<Outcome<EntryResult>> {
  signal.throwIfAborted();

  if (state.paths.size >= MAX_ENTRIES) throw new Error('Tarball exceeds entry limit');
  const file = inspectHeader(entry.header, state);

  if (state.paths.has(file.path)) throw new Error('Duplicate tarball path');
  state.paths.add(file.path);
  const isChangelog = file.type === 'file' && CHANGELOG_NAME.test(posix.basename(file.path));
  const allowance = changelogAllowance(file, isChangelog, state.changelogBytes);
  state.changelogBytes += allowance;

  const task: Promise<Outcome<EntryResult>> = inspectContent(entry, file, allowance, signal).then(
    ({ text, sha256 }): Outcome<EntryResult> => ({
      ok: true,
      value: { file: { ...file, sha256 }, text, isChangelog },
    }),
    (cause): Outcome<EntryResult> => {
      state.firstTaskFailure ??= cause;
      parser.destroy(toTarballError(cause));

      return { ok: false, cause };
    },
  );

  return task;
}

async function collectEntryResults(
  parser: TarParser,
  signal: AbortSignal,
  state: EntryInspectionState,
): Promise<Array<Outcome<EntryResult>>> {
  for await (const entry of parser) state.tasks.push(inspectEntry(entry, state, parser, signal));

  return Promise.all(state.tasks);
}

function finalizeEntries(results: Array<Outcome<EntryResult>>, state: EntryInspectionState): InspectionResult {
  for (const result of results) {
    if (!result.ok) throw result.cause;
    const { file, text, isChangelog } = result.value;

    if (file.path) state.files.push(file);

    if (isChangelog) {
      const changelog = decodeChangelog(file, text, state.reasons);

      if (changelog) state.changelogs.push(changelog);
    }
  }

  state.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  state.changelogs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { files: state.files, changelogs: state.changelogs, reasons: [...state.reasons] };
}

async function inspectEntries(parser: TarParser, signal: AbortSignal, packageRoot: string): Promise<InspectionResult> {
  const state = createEntryState(packageRoot);

  try {
    const results = await collectEntryResults(parser, signal, state);

    return finalizeEntries(results, state);
  } catch (cause) {
    parser.destroy(toTarballError(state.firstTaskFailure ?? cause));
    await Promise.all(state.tasks);
    throw state.firstTaskFailure ?? cause;
  }
}

const unavailableTarball = (url: string, cause: unknown): PackageTarball => ({
  url,
  status: 'unavailable',
  reasons: [cause instanceof Error ? cause.message : 'Tarball inspection failed'],
  files: [],
  changelogs: [],
});

const inspectPackageTarball = (
  url: string,
  dist: RegistryVersionManifest['dist'],
  packageRoot: string,
): Effect.Effect<InspectedTarball, Error> =>
  Effect.tryPromise({
    try: async (signal) => {
      const body = await downloadTarball(url, signal);
      verifyIntegrity(body, dist);

      return body;
    },
    catch: toTarballError,
  }).pipe(
    Effect.flatMap((body) => inspectTarball(body, (parser, signal) => inspectEntries(parser, signal, packageRoot))),
    Effect.map((result): InspectedTarball => ({ status: result.reasons.length ? 'partial' : 'available', ...result })),
    Effect.timeout(TIMEOUT_MS),
  );

export const getPackageTarball = (manifest: RegistryVersionManifest): Effect.Effect<PackageTarball> => {
  const url = manifest.dist.tarball;
  let normalizedUrl: string;

  try {
    normalizedUrl = normalizeSafeTarballUrl(url);
  } catch (cause) {
    return Effect.succeed(unavailableTarball(url, cause));
  }

  return inspectPackageTarball(normalizedUrl, manifest.dist, posix.basename(manifest.name)).pipe(
    Effect.map((result) => ({ ...result, url })),
    Effect.catch((cause) => Effect.succeed(unavailableTarball(url, cause))),
  );
};
