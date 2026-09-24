import { Buffer } from 'node:buffer';

import type { DurableObjectStorage } from '@cloudflare/workers-types';

import type {
  ComparisonEvidenceCache,
  ComparisonEvidenceCacheOptions,
} from '../../server/utils/packageComparisonFacts';

const CHUNK_BYTES = 128 * 1024;

export class EvidenceStorageError extends Error {
  readonly name: string = 'EvidenceStorageError';
}

export class EvidenceStorageCorruptionError extends EvidenceStorageError {
  readonly name: string = 'EvidenceStorageCorruptionError';
}

type RecordRow = Record<string, string | number | null> & {
  key: string;
  expires_at: number | null;
  chunk_count: number;
  byte_length: number;
};

type ChunkRow = Record<string, string | number | null> & {
  chunk_index: number;
  payload: string;
};

type CachedValue = { found: true; value: unknown } | { found: false };

const CHUNK_UTF16_UNITS = Math.floor(CHUNK_BYTES / 3);

/** SQLite-backed cache used by one PackageEvidence object. Rows and chunks are replaced atomically. */
export class SqlEvidenceCache implements ComparisonEvidenceCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private initError: unknown = undefined;

  constructor(private readonly storage: DurableObjectStorage) {
    try {
      storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS evidence_records (
          key TEXT PRIMARY KEY NOT NULL,
          expires_at INTEGER,
          chunk_count INTEGER NOT NULL,
          byte_length INTEGER NOT NULL
        )`,
      );
      storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS evidence_chunks (
          key TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY (key, chunk_index)
        )`,
      );
      storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS evidence_expiry_index ON evidence_records(expires_at) WHERE expires_at IS NOT NULL',
      );
    } catch (cause) {
      this.initError = cause;
    }
  }

  async load<T>(key: string, loader: () => Promise<T>, options: ComparisonEvidenceCacheOptions<T>): Promise<T> {
    this.ensureReady();
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return validateValue(await existing, options);

    this.cleanupExpired();
    const cached = this.read(key, Date.now());
    if (cached.found) return validateValue(cached.value, options);

    const pending = this.populate(key, loader, options);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  cleanupExpired(now = Date.now()): void {
    this.ensureReady();
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'DELETE FROM evidence_chunks WHERE key IN (SELECT key FROM evidence_records WHERE expires_at IS NOT NULL AND expires_at <= ?)',
        now,
      );
      this.storage.sql.exec('DELETE FROM evidence_records WHERE expires_at IS NOT NULL AND expires_at <= ?', now);
    });
  }

  private async populate<T>(
    key: string,
    loader: () => Promise<T>,
    options: ComparisonEvidenceCacheOptions<T>,
  ): Promise<T> {
    const value = await loader();
    if (options.cacheable(value)) this.write(key, value, options.ttlMs);
    return value;
  }

  private ensureReady(): void {
    if (this.initError !== undefined)
      throw new EvidenceStorageError('Evidence SQLite initialization failed', { cause: this.initError });
  }

  private read(key: string, now: number): CachedValue {
    const row = this.storage.sql
      .exec<RecordRow>('SELECT key, expires_at, chunk_count, byte_length FROM evidence_records WHERE key = ?', key)
      .toArray()[0];
    if (row === undefined) return { found: false };
    validateMetadata(row);
    if (row.expires_at !== null && row.expires_at <= now) {
      this.delete(key);
      return { found: false };
    }

    const serialized = this.readSerialized(row);
    try {
      const value: unknown = JSON.parse(serialized);
      return { found: true, value };
    } catch (cause) {
      throw new EvidenceStorageCorruptionError('Evidence payload is not valid JSON', { cause });
    }
  }

  private readSerialized(row: RecordRow): string {
    const chunks = this.storage.sql
      .exec<ChunkRow>(
        'SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index ASC',
        row.key,
      )
      .toArray();
    if (chunks.length !== row.chunk_count) throw new EvidenceStorageCorruptionError('Evidence chunks are incomplete');
    let serialized = '';
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk === undefined || chunk.chunk_index !== index || typeof chunk.payload !== 'string') {
        throw new EvidenceStorageCorruptionError('Evidence chunk order is invalid');
      }
      serialized += chunk.payload;
    }
    if (Buffer.byteLength(serialized, 'utf8') !== row.byte_length) {
      throw new EvidenceStorageCorruptionError('Evidence payload length is invalid');
    }
    return serialized;
  }

  private write<T>(key: string, value: T, ttlMs: number | null): void {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new EvidenceStorageError('Evidence value cannot be serialized');
    const chunks = splitUtf8(serialized, CHUNK_BYTES);
    const expiresAt = ttlMs === null ? null : Date.now() + ttlMs;
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM evidence_chunks WHERE key = ?', key);
      this.storage.sql.exec('DELETE FROM evidence_records WHERE key = ?', key);
      this.storage.sql.exec(
        'INSERT INTO evidence_records (key, expires_at, chunk_count, byte_length) VALUES (?, ?, ?, ?)',
        key,
        expiresAt,
        chunks.length,
        byteLength,
      );
      for (const [index, payload] of chunks.entries()) {
        this.storage.sql.exec(
          'INSERT INTO evidence_chunks (key, chunk_index, payload) VALUES (?, ?, ?)',
          key,
          index,
          payload,
        );
      }
    });
  }

  private delete(key: string): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM evidence_chunks WHERE key = ?', key);
      this.storage.sql.exec('DELETE FROM evidence_records WHERE key = ?', key);
    });
  }
}

function validateValue<T>(value: unknown, options: ComparisonEvidenceCacheOptions<T>): T {
  if (!options.isValid(value)) throw new EvidenceStorageCorruptionError('Evidence value does not match its schema');
  return value;
}

function validateMetadata(row: RecordRow): void {
  if (
    !Number.isSafeInteger(row.chunk_count) ||
    row.chunk_count <= 0 ||
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length < 0 ||
    (row.expires_at !== null && !Number.isSafeInteger(row.expires_at))
  )
    throw new EvidenceStorageCorruptionError('Evidence metadata is invalid');
}

function splitUtf8(value: string, limit: number): string[] {
  const chunks: string[] = [];
  const units = Math.min(Math.floor(limit / 3), CHUNK_UTF16_UNITS);
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + units, value.length);
    if (
      end < value.length &&
      end > start &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 &&
      value.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks.length > 0 ? chunks : [''];
}
