import { describe, expect, it } from 'vitest';

import type { ComparisonEvidenceCacheOptions } from '../../server/utils/packageComparisonFacts';
import { SqlEvidenceCache } from './store';

const options = {
  ttlMs: null,
  cacheable: Boolean,
  isValid: (value: unknown): value is string => typeof value === 'string',
} satisfies ComparisonEvidenceCacheOptions<string>;

type EvidenceCacheStorage = ConstructorParameters<typeof SqlEvidenceCache>[0];
type SqlValue = string | number | ArrayBuffer | null;

function fakeStorage(): EvidenceCacheStorage {
  return {
    sql: {
      exec<T extends Record<string, SqlValue>>(query: string, ..._bindings: SqlValue[]) {
        if (query.startsWith('SELECT key, expires_at')) throw new Error('SQLite unavailable');
        return {
          toArray(): T[] {
            return [];
          },
        };
      },
    },
    transactionSync<T>(operation: () => T): T {
      return operation();
    },
  };
}

describe('evidence cache storage failures', () => {
  it('rejects construction when schema initialization fails', () => {
    const cause = new Error('SQLite initialization unavailable');
    const storage = fakeStorage();
    storage.sql.exec = () => {
      throw cause;
    };

    expect(() => new SqlEvidenceCache(storage)).toThrowError(
      expect.objectContaining({ _tag: 'EvidenceStorageError', operation: 'initialize', cause }),
    );
  });

  it('tags SQL read failures and does not treat them as cache misses', async () => {
    const cache = new SqlEvidenceCache(fakeStorage());
    let loaderCalls = 0;

    await expect(
      cache.load(
        'evidence-key',
        async () => {
          loaderCalls += 1;
          return 'fresh evidence';
        },
        options,
      ),
    ).rejects.toMatchObject({ _tag: 'EvidenceStorageError', operation: 'read' });
    expect(loaderCalls).toBe(0);
  });
});
