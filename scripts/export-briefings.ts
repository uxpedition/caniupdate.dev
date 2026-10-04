import { createHash } from 'node:crypto';
import { closeSync, existsSync, linkSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { Schema } from 'effect';

import { AvailablePackageBriefingSchema } from '../shared/briefing.defs.ts';
import { packageBriefings } from '../shared/db/briefingSchema.ts';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  throw new Error('Usage: node scripts/export-briefings.ts SOURCE.sqlite OUTPUT.sql');
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
if (source === output || existsSync(output)) {
  throw new Error('Output must be a new file, different from source');
}

const temporary = `${output}.${process.pid}.${createHash('sha256').update(source).digest('hex').slice(0, 8)}.tmp`;
const database = new DatabaseSync(source, { readOnly: true });
const validate = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const evidenceHashPattern = /^[a-f0-9]{64}$/;
// SQL text literals escape only single quotes, so the stored JSON bytes survive verbatim.
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

let descriptor: number | undefined;
let temporaryCreated = false;
let count = 0;
try {
  // One read transaction keeps the snapshot consistent while rows stream out of the source.
  database.exec('BEGIN');
  descriptor = openSync(temporary, 'wx', 0o600);
  temporaryCreated = true;
  const db = drizzle({ client: database });
  const query = db
    .select({
      evidence_hash: packageBriefings.evidenceHash,
      response_json: packageBriefings.responseJson,
      created_at: packageBriefings.createdAt,
    })
    .from(packageBriefings)
    .orderBy(packageBriefings.evidenceHash)
    .toSQL();
  if (query.params.length !== 0) throw new Error('Briefing export query must not contain bindings');
  for (const row of database.prepare(query.sql).iterate()) {
    const hash = row.evidence_hash;
    const response = row.response_json;
    const createdAt = row.created_at;
    if (
      typeof hash !== 'string' ||
      !evidenceHashPattern.test(hash) ||
      typeof response !== 'string' ||
      typeof createdAt !== 'string'
    ) {
      throw new Error('Invalid stored briefing row');
    }
    validate(JSON.parse(response));
    // JSON text is escaped, not decoded/re-encoded: preserve the stored paid-for response verbatim.
    writeFileSync(
      descriptor,
      `INSERT INTO package_briefings (evidence_hash, response_json, created_at) VALUES (${literal(hash)}, ${literal(response)}, ${literal(createdAt)}) ON CONFLICT (evidence_hash) DO NOTHING;\n`,
    );
    count++;
  }
  database.exec('COMMIT');
  closeSync(descriptor);
  descriptor = undefined;
  // Hard-link publication is atomic and fails if the output already exists; rename could overwrite it.
  linkSync(temporary, output);
  unlinkSync(temporary);
  temporaryCreated = false;
  console.log(`Exported ${count} validated briefing snapshots to ${output}`);
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  database.close();
  if (temporaryCreated) unlinkSync(temporary);
}
