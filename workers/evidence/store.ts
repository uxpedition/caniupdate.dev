import { Buffer } from 'node:buffer';

import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';

import { EvidenceStorageCorruptionError, EvidenceStorageError } from '../../server/comparison/evidence/errors';
import type {
  ComparisonEvidenceCache,
  ComparisonEvidenceCacheOptions,
} from '../../server/comparison/evidence/services';
import { evidenceChunks, evidenceRecords } from '../../shared/db/evidenceSchema';
import evidenceMigrations from './migrations.generated.json' with { type: 'json' };

export { EvidenceStorageCorruptionError, EvidenceStorageError };

const CHUNK_BYTES = 128 * 1024;
type RecordRow = typeof evidenceRecords.$inferSelect;
type CachedValue = { found: true; value: unknown } | { found: false };

const CHUNK_UTF16_UNITS = Math.floor(CHUNK_BYTES / 3);

/** SQLite-backed cache used by one PackageEvidence object. Rows and chunks are replaced atomically. */
export class SqlEvidenceCache implements ComparisonEvidenceCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly db: DrizzleSqliteDODatabase;

  constructor(storage: DurableObjectStorage) {
    try {
      const db = drizzle(storage);
      migrate(db, { migrations: evidenceMigrations });
      this.db = db;
    } catch (cause) {
      throw new EvidenceStorageError({ operation: 'initialize', cause });
    }
  }

  async load<T>(key: string, loader: () => Promise<T>, options: ComparisonEvidenceCacheOptions<T>): Promise<T> {
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
    storageOperation('cleanup', () => {
      this.db.transaction((tx) => {
        const expired = and(isNotNull(evidenceRecords.expiresAt), lte(evidenceRecords.expiresAt, now));
        const keys = tx.select({ key: evidenceRecords.key }).from(evidenceRecords).where(expired);
        tx.delete(evidenceChunks).where(inArray(evidenceChunks.key, keys)).run();
        tx.delete(evidenceRecords).where(expired).run();
      });
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

  private read(key: string, now: number): CachedValue {
    const row = storageOperation('read', () =>
      this.db.select().from(evidenceRecords).where(eq(evidenceRecords.key, key)).get(),
    );
    if (row === undefined) return { found: false };
    validateMetadata(row);
    if (row.expiresAt !== null && row.expiresAt <= now) {
      this.delete(key);
      return { found: false };
    }

    const serialized = this.readSerialized(row);
    try {
      const value: unknown = JSON.parse(serialized);
      return { found: true, value };
    } catch (cause) {
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence payload is not valid JSON', cause });
    }
  }

  private readSerialized(row: RecordRow): string {
    const chunks = storageOperation('read', () =>
      this.db
        .select({ chunkIndex: evidenceChunks.chunkIndex, payload: evidenceChunks.payload })
        .from(evidenceChunks)
        .where(eq(evidenceChunks.key, row.key))
        .orderBy(asc(evidenceChunks.chunkIndex))
        .all(),
    );
    if (chunks.length !== row.chunkCount)
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence chunks are incomplete' });
    let serialized = '';
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk === undefined || chunk.chunkIndex !== index || typeof chunk.payload !== 'string') {
        throw new EvidenceStorageCorruptionError({ detail: 'Evidence chunk order is invalid' });
      }
      serialized += chunk.payload;
    }
    if (Buffer.byteLength(serialized, 'utf8') !== row.byteLength) {
      throw new EvidenceStorageCorruptionError({ detail: 'Evidence payload length is invalid' });
    }
    return serialized;
  }

  private write<T>(key: string, value: T, ttlMs: number | null): void {
    const serialized = storageOperation('serialize', () => JSON.stringify(value));
    if (serialized === undefined)
      throw new EvidenceStorageError({
        operation: 'serialize',
        cause: new TypeError('Evidence value cannot be serialized'),
      });
    const chunks = splitUtf8(serialized, CHUNK_BYTES);
    const expiresAt = ttlMs === null ? null : Date.now() + ttlMs;
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    storageOperation('write', () =>
      this.db.transaction((tx) => {
        tx.delete(evidenceChunks).where(eq(evidenceChunks.key, key)).run();
        tx.delete(evidenceRecords).where(eq(evidenceRecords.key, key)).run();
        tx.insert(evidenceRecords).values({ key, expiresAt, chunkCount: chunks.length, byteLength }).run();
        for (const [chunkIndex, payload] of chunks.entries()) {
          tx.insert(evidenceChunks).values({ key, chunkIndex, payload }).run();
        }
      }),
    );
  }

  private delete(key: string): void {
    storageOperation('delete', () =>
      this.db.transaction((tx) => {
        tx.delete(evidenceChunks).where(eq(evidenceChunks.key, key)).run();
        tx.delete(evidenceRecords).where(eq(evidenceRecords.key, key)).run();
      }),
    );
  }
}

type StorageOperation = 'read' | 'write' | 'cleanup' | 'delete' | 'serialize';

function storageOperation<T>(operation: StorageOperation, run: () => T): T {
  try {
    return run();
  } catch (cause) {
    if (cause instanceof EvidenceStorageError || cause instanceof EvidenceStorageCorruptionError) throw cause;
    throw new EvidenceStorageError({ operation, cause });
  }
}

function validateValue<T>(value: unknown, options: ComparisonEvidenceCacheOptions<T>): T {
  if (!options.isValid(value))
    throw new EvidenceStorageCorruptionError({ detail: 'Evidence value does not match its schema' });
  return value;
}

function validateMetadata(row: RecordRow): void {
  if (
    !Number.isSafeInteger(row.chunkCount) ||
    row.chunkCount <= 0 ||
    !Number.isSafeInteger(row.byteLength) ||
    row.byteLength < 0 ||
    (row.expiresAt !== null && !Number.isSafeInteger(row.expiresAt))
  )
    throw new EvidenceStorageCorruptionError({ detail: 'Evidence metadata is invalid' });
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
