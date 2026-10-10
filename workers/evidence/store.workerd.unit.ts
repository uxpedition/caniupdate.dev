import { Buffer } from 'node:buffer';

import type { SqlStorageValue } from '@cloudflare/workers-types';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  openEvidenceCacheFixture,
  type EvidenceCacheFixture,
  type EvidenceCacheFixtureOptions,
} from './test/cache.harness';

const FixtureErrorSchema = Schema.Struct({
  _tag: Schema.String,
  operation: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  causeName: Schema.optionalKey(Schema.String),
  causeMessage: Schema.optionalKey(Schema.String),
});

const FixtureResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown, loaderCalls: Schema.Finite }),
  Schema.Struct({ ok: Schema.Literal(false), error: FixtureErrorSchema, loaderCalls: Schema.Finite }),
]);

const LoaderOutcomeSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: FixtureErrorSchema }),
]);

const CoalescedOutcomesSchema = Schema.Struct({ first: LoaderOutcomeSchema, second: LoaderOutcomeSchema });

const SqlChunkRowsSchema = Schema.Array(Schema.Struct({ chunk_index: Schema.Finite, payload: Schema.String }));

const decodeFixtureResult = Schema.decodeUnknownSync(FixtureResultSchema, { errors: 'all' });

const decodeCoalescedOutcomes = Schema.decodeUnknownSync(CoalescedOutcomesSchema, { errors: 'all' });

const decodeSqlChunkRows = Schema.decodeUnknownSync(SqlChunkRowsSchema, { errors: 'all' });

type CorruptionCase = {
  name: string;
  chunkCount: number;
  byteLength: number;
  chunks: readonly { index: number; payload: string }[];
  validation: 'string' | 'reject';
};

type SerializationCase = { kind: 'undefined' | 'circular'; key: string };

const serializationCases: SerializationCase[] = [
  { kind: 'undefined', key: 'serialize-undefined' },
  { kind: 'circular', key: 'serialize-circular' },
];

const corruptionCases: CorruptionCase[] = [
  { name: 'invalid metadata', chunkCount: 0, byteLength: 0, chunks: [], validation: 'string' },
  { name: 'missing chunk', chunkCount: 1, byteLength: 5, chunks: [], validation: 'string' },
  {
    name: 'noncontiguous chunk indexes',
    chunkCount: 1,
    byteLength: 5,
    chunks: [{ index: 1, payload: '"old"' }],
    validation: 'string',
  },
  {
    name: 'incorrect byte length',
    chunkCount: 1,
    byteLength: 4,
    chunks: [{ index: 0, payload: '"old"' }],
    validation: 'string',
  },
  {
    name: 'malformed JSON',
    chunkCount: 1,
    byteLength: 8,
    chunks: [{ index: 0, payload: 'not-json' }],
    validation: 'string',
  },
  {
    name: 'caller schema rejection',
    chunkCount: 1,
    byteLength: 7,
    chunks: [{ index: 0, payload: '"valid"' }],
    validation: 'reject',
  },
];

function numberField(row: Record<string, SqlStorageValue> | undefined, name: string): number {
  const value = row?.[name];

  if (typeof value !== 'number') throw new Error(`Expected numeric SQLite column ${name}`);

  return value;
}

async function withFixture(
  operation: (fixture: EvidenceCacheFixture) => Promise<void>,
  options?: EvidenceCacheFixtureOptions,
): Promise<void> {
  const fixture = await openEvidenceCacheFixture(options);

  try {
    await operation(fixture);
  } finally {
    await fixture.dispose();
  }
}

async function seedLegacyCache(fixture: EvidenceCacheFixture): Promise<void> {
  await fixture.exec(`CREATE TABLE evidence_records (
    key TEXT PRIMARY KEY NOT NULL, expires_at INTEGER,
    chunk_count INTEGER NOT NULL, byte_length INTEGER NOT NULL)`);
  await fixture.exec(`CREATE TABLE evidence_chunks (
    key TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (key, chunk_index))`);
  await fixture.exec('CREATE INDEX evidence_expiry_index ON evidence_records(expires_at) WHERE expires_at IS NOT NULL');
  await fixture.exec("INSERT INTO evidence_records VALUES ('legacy', NULL, 1, 5)");
  await fixture.exec('INSERT INTO evidence_chunks VALUES (?, ?, ?)', 'legacy', 0, '"old"');
}

describe('evidence cache in real SQLite workerd storage', () => {
  it('adopts populated legacy tables without regenerating or changing cached data', async () => {
    await withFixture(
      async (fixture) => {
        await seedLegacyCache(fixture);

        const result = decodeFixtureResult(
          await fixture.call({
            operation: 'load',
            key: 'legacy',
            value: 'replacement',
            ttlMs: null,
            cacheable: true,
            validation: 'string',
          }),
        );

        expect(result).toMatchObject({ ok: true, value: 'old', loaderCalls: 0 });
        expect(await fixture.exec('SELECT * FROM evidence_records')).toEqual([
          { key: 'legacy', expires_at: null, chunk_count: 1, byte_length: 5 },
        ]);
        expect(await fixture.exec('SELECT * FROM evidence_chunks')).toEqual([
          { key: 'legacy', chunk_index: 0, payload: '"old"' },
        ]);
        expect(
          numberField((await fixture.exec('SELECT COUNT(*) AS count FROM __drizzle_migrations'))[0], 'count'),
        ).toBe(1);
      },
      { initialize: false },
    );
  }, 120_000);

  it('preserves cached data and applies bootstrap only once across persisted restart', async () => {
    await withFixture(async (fixture) => {
      await fixture.call({
        operation: 'load',
        key: 'restart',
        value: 'persisted',
        ttlMs: null,
        cacheable: true,
        validation: 'string',
      });
      const records = await fixture.exec('SELECT * FROM evidence_records');
      const chunks = await fixture.exec('SELECT * FROM evidence_chunks');
      await fixture.restart();
      expect(
        decodeFixtureResult(
          await fixture.call({
            operation: 'load',
            key: 'restart',
            value: 'replacement',
            ttlMs: null,
            cacheable: true,
            validation: 'string',
          }),
        ),
      ).toMatchObject({ ok: true, value: 'persisted', loaderCalls: 0 });
      expect(await fixture.exec('SELECT * FROM evidence_records')).toEqual(records);
      expect(await fixture.exec('SELECT * FROM evidence_chunks')).toEqual(chunks);
      expect(numberField((await fixture.exec('SELECT COUNT(*) AS count FROM __drizzle_migrations'))[0], 'count')).toBe(
        1,
      );
    });
  });

  it('retains the actual migration SQL failure cause and rolls back ledger insertion', async () => {
    await withFixture(
      async (fixture) => {
        await seedLegacyCache(fixture);
        await fixture.exec(
          'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)',
        );
        await fixture.exec(`CREATE TRIGGER refuse_migration BEFORE INSERT ON __drizzle_migrations
        BEGIN SELECT RAISE(ABORT, 'fixture migration refusal'); END`);
        const result = decodeFixtureResult(await fixture.call({ operation: 'initialize' }));
        expect(result.ok).toBe(false);

        if (result.ok) throw new Error('Refused migration unexpectedly initialized');
        expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'initialize' });
        expect(result.error.causeMessage).toContain('fixture migration refusal');
        expect(await fixture.exec('SELECT * FROM evidence_chunks')).toEqual([
          { key: 'legacy', chunk_index: 0, payload: '"old"' },
        ]);
        expect(
          numberField((await fixture.exec('SELECT COUNT(*) AS count FROM __drizzle_migrations'))[0], 'count'),
        ).toBe(0);
      },
      { initialize: false },
    );
  });
  it('creates the declared tables, keys, columns, and partial expiry index', async () => {
    await withFixture(async (fixture) => {
      const records = await fixture.exec('PRAGMA table_info(evidence_records)');
      expect(records.map((row) => [row.name, row.type, row.notnull, row.pk])).toEqual([
        ['key', 'TEXT', 1, 1],
        ['expires_at', 'INTEGER', 0, 0],
        ['chunk_count', 'INTEGER', 1, 0],
        ['byte_length', 'INTEGER', 1, 0],
      ]);

      const chunks = await fixture.exec('PRAGMA table_info(evidence_chunks)');
      expect(chunks.map((row) => [row.name, row.type, row.notnull, row.pk])).toEqual([
        ['key', 'TEXT', 1, 1],
        ['chunk_index', 'INTEGER', 1, 2],
        ['payload', 'TEXT', 1, 0],
      ]);

      const indexes = await fixture.exec("PRAGMA index_list('evidence_records')");
      expect(indexes.find((row) => row.name === 'evidence_expiry_index')).toMatchObject({
        name: 'evidence_expiry_index',
        unique: 0,
        origin: 'c',
        partial: 1,
      });
      const indexColumns = await fixture.exec("PRAGMA index_info('evidence_expiry_index')");
      expect(indexColumns.map((row) => row.name)).toEqual(['expires_at']);
    });
  }, 120_000);

  it('chunks a large multibyte miss and returns the persisted value on the next hit', async () => {
    await withFixture(async (fixture) => {
      const value = '界'.repeat(100_000);

      const first = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'multibyte',
          value,
          ttlMs: null,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(first.ok).toBe(true);

      if (!first.ok) throw new Error('Large multibyte miss unexpectedly failed');
      expect(first.value).toBe(value);
      expect(first.loaderCalls).toBe(1);

      const metadata = await fixture.exec(
        'SELECT chunk_count, byte_length FROM evidence_records WHERE key = ?',
        'multibyte',
      );

      expect(numberField(metadata[0], 'chunk_count')).toBeGreaterThan(1);
      expect(numberField(metadata[0], 'byte_length')).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));

      const chunks = decodeSqlChunkRows(
        await fixture.exec(
          'SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index',
          'multibyte',
        ),
      );

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.map((row) => row.payload).join('')).toBe(JSON.stringify(value));

      const hit = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'multibyte',
          value: 'must not replace the stored result',
          ttlMs: null,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(hit).toEqual({ ok: true, value, loaderCalls: 1 });
    });
  });

  it('runs one same-key loader and shares its value with both callers', async () => {
    await withFixture(async (fixture) => {
      const result = decodeFixtureResult(
        await fixture.call({ operation: 'coalesce', key: 'coalesce-value', value: 'shared', rejectSecond: false }),
      );

      expect(result.ok).toBe(true);

      if (!result.ok) throw new Error('Coalesced load unexpectedly failed');
      expect(result.loaderCalls).toBe(1);
      const outcomes = decodeCoalescedOutcomes(result.value);
      expect(outcomes.first).toEqual({ ok: true, value: 'shared' });
      expect(outcomes.second).toEqual({ ok: true, value: 'shared' });
    });
  });

  it('applies a waiting same-key caller’s own validation predicate', async () => {
    await withFixture(async (fixture) => {
      const result = decodeFixtureResult(
        await fixture.call({ operation: 'coalesce', key: 'coalesce-validation', value: 'shared', rejectSecond: true }),
      );

      expect(result.ok).toBe(true);

      if (!result.ok) throw new Error('Coalesced load unexpectedly failed');
      expect(result.loaderCalls).toBe(1);
      const outcomes = decodeCoalescedOutcomes(result.value);
      expect(outcomes.first).toEqual({ ok: true, value: 'shared' });
      expect(outcomes.second).toMatchObject({
        ok: false,
        error: { _tag: 'EvidenceStorageCorruptionError' },
      });
    });
  });

  it('shares a same-key storage write failure with both callers', async () => {
    await withFixture(async (fixture) => {
      await fixture.exec(`CREATE TRIGGER refuse_coalesced_write
        BEFORE INSERT ON evidence_chunks
        BEGIN SELECT RAISE(ABORT, 'coalesced fixture refusal'); END`);

      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'coalesce',
          key: 'coalesce-write-error',
          value: 'shared',
          rejectSecond: false,
        }),
      );

      expect(result.ok).toBe(true);

      if (!result.ok) throw new Error('Coalesced command unexpectedly failed');
      expect(result.loaderCalls).toBe(1);
      const outcomes = decodeCoalescedOutcomes(result.value);
      expect(outcomes.first).toMatchObject({
        ok: false,
        error: { _tag: 'EvidenceStorageError', operation: 'write' },
      });
      expect(outcomes.second).toMatchObject({
        ok: false,
        error: { _tag: 'EvidenceStorageError', operation: 'write' },
      });

      if (outcomes.first.ok || outcomes.second.ok) throw new Error('Expected both callers to share the write failure');
      expect(outcomes.first.error.causeMessage).toContain('coalesced fixture refusal');
      expect(outcomes.second.error.causeMessage).toBe(outcomes.first.error.causeMessage);
      expect(await fixture.exec('SELECT key FROM evidence_records WHERE key = ?', 'coalesce-write-error')).toEqual([]);
      expect(await fixture.exec('SELECT key FROM evidence_chunks WHERE key = ?', 'coalesce-write-error')).toEqual([]);
    });
  });

  it('deletes records expiring at the boundary while retaining future and permanent rows', async () => {
    await withFixture(async (fixture) => {
      const future = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'future',
          value: 'future',
          ttlMs: 60_000,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(future.ok).toBe(true);

      const permanent = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'permanent',
          value: 'permanent',
          ttlMs: null,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(permanent.ok).toBe(true);

      const boundary = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'boundary',
          value: 'boundary',
          ttlMs: 0,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(boundary.ok).toBe(true);

      const expirations = await fixture.exec('SELECT key, expires_at FROM evidence_records ORDER BY key');

      const boundaryExpiration = numberField(
        expirations.find((row) => row.key === 'boundary'),
        'expires_at',
      );

      const futureExpiration = numberField(
        expirations.find((row) => row.key === 'future'),
        'expires_at',
      );

      const permanentExpiration = expirations.find((row) => row.key === 'permanent');
      expect(futureExpiration).toBeGreaterThan(boundaryExpiration);
      expect(permanentExpiration?.expires_at).toBeNull();

      const cleanup = decodeFixtureResult(await fixture.call({ operation: 'cleanup', now: boundaryExpiration }));
      expect(cleanup.ok).toBe(true);
      expect(await fixture.exec('SELECT key FROM evidence_records ORDER BY key')).toEqual([
        { key: 'future' },
        { key: 'permanent' },
      ]);
      expect(await fixture.exec('SELECT key FROM evidence_chunks ORDER BY key')).toEqual([
        { key: 'future' },
        { key: 'permanent' },
      ]);
    });
  });

  it('replaces all old chunks and metadata when a loader writes a new value', async () => {
    await withFixture(async (fixture) => {
      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load-replacing',
          key: 'replacement',
          oldValue: 'x'.repeat(128 * 1024 + 10),
          value: 'new',
          ttlMs: null,
        }),
      );

      expect(result).toEqual({ ok: true, value: 'new', loaderCalls: 1 });
      expect(
        await fixture.exec('SELECT chunk_count, byte_length FROM evidence_records WHERE key = ?', 'replacement'),
      ).toEqual([{ chunk_count: 1, byte_length: 5 }]);
      expect(
        await fixture.exec(
          'SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index',
          'replacement',
        ),
      ).toEqual([{ chunk_index: 0, payload: '"new"' }]);
    });
  });

  it('restores old metadata and chunks when replacement fails midway', async () => {
    await withFixture(async (fixture) => {
      await fixture.exec(`CREATE TRIGGER refuse_second_chunk
        BEFORE INSERT ON evidence_chunks WHEN NEW.chunk_index = 1
        BEGIN SELECT RAISE(ABORT, 'fixture refusal'); END`);

      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load-replacing',
          key: 'rollback',
          oldValue: 'old',
          value: '界'.repeat(100_000),
          ttlMs: null,
        }),
      );

      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Replacement unexpectedly succeeded');
      expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'write' });
      expect(result.error.causeMessage).toContain('fixture refusal');
      expect(result.loaderCalls).toBe(1);
      expect(
        await fixture.exec('SELECT chunk_count, byte_length FROM evidence_records WHERE key = ?', 'rollback'),
      ).toEqual([{ chunk_count: 1, byte_length: 5 }]);
      expect(
        await fixture.exec(
          'SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index',
          'rollback',
        ),
      ).toEqual([{ chunk_index: 0, payload: '"old"' }]);
    });
  });

  it('restores deleted chunks when expired-record cleanup rolls back', async () => {
    await withFixture(async (fixture) => {
      await fixture.exec(
        'INSERT INTO evidence_records (key, expires_at, chunk_count, byte_length) VALUES (?, ?, ?, ?)',
        'cleanup-rollback',
        20,
        1,
        5,
      );
      await fixture.exec(
        'INSERT INTO evidence_chunks (key, chunk_index, payload) VALUES (?, ?, ?)',
        'cleanup-rollback',
        0,
        '"old"',
      );
      await fixture.exec(`CREATE TRIGGER refuse_record_delete
        BEFORE DELETE ON evidence_records WHEN OLD.key = 'cleanup-rollback'
        BEGIN SELECT RAISE(ABORT, 'fixture refusal'); END`);

      const result = decodeFixtureResult(await fixture.call({ operation: 'cleanup', now: 20 }));
      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Faulted cleanup unexpectedly succeeded');
      expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'cleanup' });
      expect(result.error.causeMessage).toContain('fixture refusal');
      expect(
        await fixture.exec(
          'SELECT expires_at, chunk_count, byte_length FROM evidence_records WHERE key = ?',
          'cleanup-rollback',
        ),
      ).toEqual([{ expires_at: 20, chunk_count: 1, byte_length: 5 }]);
      expect(
        await fixture.exec(
          'SELECT chunk_index, payload FROM evidence_chunks WHERE key = ? ORDER BY chunk_index',
          'cleanup-rollback',
        ),
      ).toEqual([{ chunk_index: 0, payload: '"old"' }]);
    });
  });

  it.each(corruptionCases)('rejects $name as corruption without calling the loader', async (testCase) => {
    await withFixture(async (fixture) => {
      const key = `corruption-${testCase.name}`;
      await fixture.exec(
        'INSERT INTO evidence_records (key, expires_at, chunk_count, byte_length) VALUES (?, ?, ?, ?)',
        key,
        null,
        testCase.chunkCount,
        testCase.byteLength,
      );

      for (const chunk of testCase.chunks) {
        await fixture.exec(
          'INSERT INTO evidence_chunks (key, chunk_index, payload) VALUES (?, ?, ?)',
          key,
          chunk.index,
          chunk.payload,
        );
      }

      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key,
          value: 'loader must not refresh corruption',
          ttlMs: null,
          cacheable: true,
          validation: testCase.validation,
        }),
      );

      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Corrupt cached evidence unexpectedly loaded');
      expect(result.error._tag).toBe('EvidenceStorageCorruptionError');
      expect(result.loaderCalls).toBe(0);
    });
  });

  it('tags incompatible pre-construction schema failure as initialize', async () => {
    await withFixture(
      async (fixture) => {
        await fixture.exec('CREATE TABLE evidence_records (key TEXT PRIMARY KEY NOT NULL)');
        await fixture.exec("INSERT INTO evidence_records VALUES ('retained')");
        const result = decodeFixtureResult(await fixture.call({ operation: 'initialize' }));
        expect(result.ok).toBe(false);

        if (result.ok) throw new Error('Incompatible schema unexpectedly initialized');
        expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'initialize' });
        expect(typeof result.error.causeMessage).toBe('string');
        expect(await fixture.exec('SELECT * FROM evidence_records')).toEqual([{ key: 'retained' }]);
        expect(
          await fixture.exec(
            "SELECT name FROM sqlite_master WHERE name IN ('evidence_chunks', '__drizzle_migrations')",
          ),
        ).toEqual([]);
      },
      { initialize: false },
    );
  });

  it('tags a dropped chunks table as cleanup before attempting a cache read', async () => {
    await withFixture(async (fixture) => {
      await fixture.exec(
        'INSERT INTO evidence_records (key, expires_at, chunk_count, byte_length) VALUES (?, ?, ?, ?)',
        'missing-chunks',
        null,
        1,
        5,
      );
      await fixture.exec(
        'INSERT INTO evidence_chunks (key, chunk_index, payload) VALUES (?, ?, ?)',
        'missing-chunks',
        0,
        '"old"',
      );
      await fixture.exec('DROP TABLE evidence_chunks');

      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'missing-chunks',
          value: 'loader must not run',
          ttlMs: null,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Failed cleanup unexpectedly loaded');
      expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'cleanup' });
      expect(result.loaderCalls).toBe(0);
    });
  });

  it('tags SQL metadata selection failures as read without calling the loader', async () => {
    await withFixture(async (fixture) => {
      await fixture.exec('ALTER TABLE evidence_records RENAME TO original_evidence_records');
      await fixture.exec(
        'CREATE TABLE evidence_records (expires_at INTEGER, chunk_count INTEGER, byte_length INTEGER)',
      );

      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'read-failure',
          value: 'loader must not run',
          ttlMs: null,
          cacheable: true,
          validation: 'string',
        }),
      );

      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Failed storage read unexpectedly loaded');
      expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'read' });
      expect(result.loaderCalls).toBe(0);
    });
  });

  it('returns a non-cacheable fresh value without persisting it', async () => {
    await withFixture(async (fixture) => {
      const result = decodeFixtureResult(
        await fixture.call({
          operation: 'load',
          key: 'non-cacheable',
          value: 'fresh only',
          ttlMs: null,
          cacheable: false,
          validation: 'string',
        }),
      );

      expect(result).toEqual({ ok: true, value: 'fresh only', loaderCalls: 1 });
      expect(await fixture.exec('SELECT key FROM evidence_records WHERE key = ?', 'non-cacheable')).toEqual([]);
      expect(await fixture.exec('SELECT key FROM evidence_chunks WHERE key = ?', 'non-cacheable')).toEqual([]);
    });
  });

  it.each(serializationCases)('tags $kind serialization failures and leaves no partial row', async ({ kind, key }) => {
    await withFixture(async (fixture) => {
      const result = decodeFixtureResult(await fixture.call({ operation: 'serialization', key, kind }));
      expect(result.ok).toBe(false);

      if (result.ok) throw new Error('Unserializable evidence unexpectedly persisted');
      expect(result.error).toMatchObject({ _tag: 'EvidenceStorageError', operation: 'serialize' });
      expect(result.error.causeName).toBe('TypeError');
      expect(result.loaderCalls).toBe(1);
      expect(await fixture.exec('SELECT key FROM evidence_records WHERE key = ?', key)).toEqual([]);
      expect(await fixture.exec('SELECT key FROM evidence_chunks WHERE key = ?', key)).toEqual([]);
    });
  });
});
