import { sql } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const packageBriefings = sqliteTable(
  'package_briefings',
  {
    evidenceHash: text('evidence_hash').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // A table-level key preserves explicit SQLite NOT NULL metadata in the pinned generator.
  (table) => [primaryKey({ columns: [table.evidenceHash] })],
);
