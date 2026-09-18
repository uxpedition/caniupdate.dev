import { createHash, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { Cache, Data, Duration, Effect, Exit } from 'effect';
import { extract, type Header } from 'tar-stream';

import type { RegistryVersionManifest } from '../../shared/package.defs';
import type { PackageTarball, PublishedFile, ShippedChangelog } from '../../shared/tarball.defs';

const decompress = promisify(gunzip);
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_CHANGELOG_BYTES = 256 * 1024;
const MAX_CHANGELOG_TOTAL_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const INSPECTION_VERSION = 'tarball-inspection-v1';
const CHANGELOG_NAME = /^(changelog|changes|history)(\.(md|markdown|txt|rst))?$/i;

type CachedTarball = Omit<PackageTarball, 'url'>;

type TarballCacheKeyFields = {
  readonly url: string;
  readonly verification: string;
  readonly verificationKind: 'integrity' | 'shasum';
  readonly inspectionVersion: string;
};

class TarballCacheKey extends Data.Class<TarballCacheKeyFields> {}

function verifyIntegrity(body: Buffer, dist: Pick<RegistryVersionManifest['dist'], 'integrity' | 'shasum'>) {
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
  const response = await fetch(normalizeSafeTarballUrl(url), { signal, redirect: 'error' });
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

function archivePath(name: string, directory: boolean): string {
  const path = directory && name.endsWith('/') ? name.slice(0, -1) : name;
  if (
    path.length > 4096 ||
    hasUnsafePathCharacters(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    (path !== 'package' && !path.startsWith('package/'))
  ) {
    throw new Error('Unsafe or unsupported tarball path');
  }
  if (path === 'package' && !directory) throw new Error('Invalid tarball root');
  return path.slice('package/'.length);
}

function inspectHeader(header: Header): PublishedFile {
  const { type, size } = header;
  if (type !== 'file' && type !== 'directory' && type !== 'symlink' && type !== 'link') {
    throw new Error('Unsupported tarball entry type');
  }
  validateEntrySize(header);
  const file: PublishedFile = { path: archivePath(header.name, type === 'directory'), type, size, sha256: null };
  if (type === 'link' || type === 'symlink') file.linkTarget = inspectLink(header);
  return file;
}

function validateEntrySize({ size, type }: Header): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid tarball entry size');
  }
  if (type !== 'file' && size !== 0) throw new Error('Invalid non-file tarball entry size');
}

function inspectLink(header: Header): string {
  const target = header.linkname;
  if (!target || target.length > 4096 || posix.isAbsolute(target) || hasUnsafePathCharacters(target)) {
    throw new Error('Unsafe tarball link');
  }
  // Hardlinks are archive-root-relative; symlinks are relative to their containing directory.
  const resolved = header.type === 'link' ? target : posix.join(posix.dirname(header.name), target);
  archivePath(resolved, false);
  return target;
}

async function inspectContent(
  entry: AsyncIterable<unknown>,
  file: PublishedFile,
  allowance: number,
  signal: AbortSignal,
) {
  const hash = file.type === 'file' ? createHash('sha256') : null;
  const text: Buffer[] = [];
  let captured = 0;
  let actual = 0;
  for await (const chunk of entry) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid tarball content chunk');
    signal.throwIfAborted();
    actual += chunk.length;
    hash?.update(chunk);
    if (captured < allowance) {
      const part = chunk.subarray(0, allowance - captured);
      text.push(part);
      captured += part.length;
    }
  }
  if (actual !== file.size) throw new Error('Incomplete tarball entry');
  file.sha256 = hash?.digest('hex') ?? null;
  return Buffer.concat(text, captured);
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

async function inspectEntries(parser: ReturnType<typeof extract>, signal: AbortSignal) {
  const files: PublishedFile[] = [];
  const changelogs: ShippedChangelog[] = [];
  const paths = new Set<string>();
  const reasons = new Set<string>();
  let changelogBytes = 0;
  for await (const entry of parser) {
    signal.throwIfAborted();
    if (paths.size >= MAX_ENTRIES) throw new Error('Tarball exceeds entry limit');
    const file = inspectHeader(entry.header);
    if (paths.has(file.path)) throw new Error('Duplicate tarball path');
    paths.add(file.path);
    const isChangelog = file.type === 'file' && CHANGELOG_NAME.test(posix.basename(file.path));
    const allowance = isChangelog ? Math.min(MAX_CHANGELOG_BYTES, MAX_CHANGELOG_TOTAL_BYTES - changelogBytes) : 0;
    const text = await inspectContent(entry, file, allowance, signal);
    if (file.path) files.push(file);
    if (isChangelog) {
      const changelog = decodeChangelog(file, text, reasons);
      if (changelog) changelogs.push(changelog);
      changelogBytes += text.length;
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  changelogs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, changelogs, reasons: [...reasons] };
}

async function inspectTarball(body: Buffer, signal: AbortSignal) {
  const bytes = await decompress(body, { maxOutputLength: MAX_ARCHIVE_BYTES });
  signal.throwIfAborted();
  if (bytes.length < 1024 || bytes.length % 512 !== 0 || bytes.subarray(-1024).some((byte) => byte !== 0)) {
    throw new Error('Incomplete tarball archive');
  }
  const parser = extract();
  // Iteration installs error handling before feeding the parser. No extraction APIs are used.
  const reading = inspectEntries(parser, signal);
  parser.end(bytes);
  try {
    return await reading;
  } finally {
    parser.destroy();
  }
}

const unavailableTarball = (url: string, cause: unknown): PackageTarball => ({
  url,
  status: 'unavailable',
  reasons: [cause instanceof Error ? cause.message : 'Tarball inspection failed'],
  files: [],
  changelogs: [],
});

const inspectCachedTarball = (key: TarballCacheKey) =>
  Effect.tryPromise({
    try: async (signal): Promise<CachedTarball> => {
      const body = await downloadTarball(key.url, signal);
      verifyIntegrity(
        body,
        key.verificationKind === 'integrity'
          ? { integrity: key.verification, shasum: '' }
          : { shasum: key.verification },
      );
      const result = await inspectTarball(body, signal);
      return { status: result.reasons.length ? 'partial' : 'available', ...result };
    },
    catch: (cause) => cause,
  }).pipe(Effect.timeout(TIMEOUT_MS));

const tarballCache = Effect.runSync(
  Cache.makeWith<TarballCacheKey, CachedTarball, unknown>(inspectCachedTarball, {
    capacity: 16,
    timeToLive: (exit) =>
      Exit.isSuccess(exit) && exit.value.status !== 'unavailable' ? Duration.hours(24) : Duration.zero,
  }),
);

export const getPackageTarball = (manifest: RegistryVersionManifest): Effect.Effect<PackageTarball> => {
  const url = manifest.dist.tarball;
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSafeTarballUrl(url);
  } catch (cause) {
    return Effect.succeed(unavailableTarball(url, cause));
  }
  const verificationKind = manifest.dist.integrity === undefined ? 'shasum' : 'integrity';
  const key = new TarballCacheKey({
    url: normalizedUrl,
    verification: manifest.dist.integrity ?? manifest.dist.shasum,
    verificationKind,
    inspectionVersion: INSPECTION_VERSION,
  });
  return Cache.get(tarballCache, key).pipe(
    Effect.map((result) => ({ ...result, url })),
    Effect.catch((cause) => Effect.succeed(unavailableTarball(url, cause))),
  );
};
