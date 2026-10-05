import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Generates synchronous Drizzle Durable Object migrations, independently of Wrangler's D1 history.
export const evidenceRecords = sqliteTable(
  'evidence_records',
  {
    key: text('key').notNull(),
    expiresAt: integer('expires_at'),
    chunkCount: integer('chunk_count').notNull(),
    byteLength: integer('byte_length').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key] }),
    index('evidence_expiry_index')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),
  ],
);

export const evidenceChunks = sqliteTable(
  'evidence_chunks',
  {
    key: text('key').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    payload: text('payload').notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.chunkIndex] })],
);
