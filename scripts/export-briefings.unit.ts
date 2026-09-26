import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AvailablePackageBriefingSchema, type AvailablePackageBriefing } from '../shared/briefing.defs';
import { openBriefingD1 } from '../test/helpers/briefingDatabase.harness';

const decodeBriefing = Schema.decodeUnknownSync(AvailablePackageBriefingSchema);
const exporterScript = fileURLToPath(new URL('./export-briefings.ts', import.meta.url));

type BriefingD1 = Awaited<ReturnType<typeof openBriefingD1>>;

// A genuine SHA-256 of the evidence packet the stored snapshot was paid for.
const evidenceHash = createHash('sha256')
  .update(JSON.stringify({ packageName: 'left-pad', from: '1.0.0', to: '1.3.0', sources: ['changelog'], gaps: [] }))
  .digest('hex');

const storedCreatedAt = '2026-09-20T12:00:00Z';

const briefing: AvailablePackageBriefing = {
  status: 'available',
  model: 'test-model',
  bullets: [
    {
      kind: 'change',
      basis: 'fact',
      text: "L'équipe a supprimé l'ancien export\npuis a renommé «createClient» — voir l'issue #12",
      evidenceIds: ['change'],
    },
  ],
  sources: [
    {
      id: 'change',
      kind: 'fact',
      label: 'Journal des modifications',
      urls: ['https://example.test/left-pad'],
      text: "{ '1.3.0': 'Renommé createClient; corrigé l'export' }",
    },
  ],
};

// The store writes compact JSON; legacy rows may be pretty-printed. Both must survive byte-for-byte.
const responseJson = JSON.stringify(briefing);
const prettyResponseJson = JSON.stringify(briefing, null, 2);

type StoredRow = { hash: string; response: string; createdAt?: string };

function writeSource(path: string, rows: readonly StoredRow[]): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`CREATE TABLE package_briefings (
      evidence_hash TEXT PRIMARY KEY NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const insert = database.prepare(
      'INSERT INTO package_briefings (evidence_hash, response_json, created_at) VALUES (?, ?, ?)',
    );
    for (const row of rows) insert.run(row.hash, row.response, row.createdAt ?? storedCreatedAt);
  } finally {
    database.close();
  }
}

function runExporter(source: string, output: string) {
  return spawnSync(process.execPath, [exporterScript, source, output], { encoding: 'utf8' });
}

async function digest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function readStored(target: BriefingD1, hash: string) {
  const row = await target.database
    .prepare('SELECT response_json, created_at FROM package_briefings WHERE evidence_hash = ?')
    .bind(hash)
    .first<{ response_json: string; created_at: string }>();
  if (row === null) return undefined;
  return {
    text: row.response_json,
    createdAt: row.created_at,
    briefing: decodeBriefing(JSON.parse(row.response_json)),
  };
}

let directory: string;
let sourcePath: string;
let exportPath: string;
const targets: BriefingD1[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'briefing-export-'));
  sourcePath = join(directory, 'briefings.db');
  exportPath = join(directory, 'briefings-export.sql');
});

afterEach(async () => {
  for (const target of targets.splice(0)) await target.dispose();
  await rm(directory, { recursive: true, force: true });
});

async function openTarget(name: string): Promise<BriefingD1> {
  const target = await openBriefingD1(join(directory, name));
  targets.push(target);
  return target;
}

describe('offline briefing export', () => {
  it('imports the stored snapshot verbatim and never replaces the first winner', async () => {
    writeSource(sourcePath, [{ hash: evidenceHash, response: responseJson }]);
    const sourceDigest = await digest(sourcePath);

    const result = runExporter(sourcePath, exportPath);
    expect(result.status, result.stderr).toBe(0);

    const sql = await readFile(exportPath, 'utf8');
    const target = await openTarget('d1');
    await target.database.exec(sql);

    const imported = await readStored(target, evidenceHash);
    expect(imported?.briefing).toEqual(briefing);
    expect(imported?.text).toBe(responseJson);
    expect(imported?.createdAt).toBe(storedCreatedAt);

    // Importing the same export again cannot replace the stored winner.
    await target.database.exec(sql);
    expect(await readStored(target, evidenceHash)).toEqual(imported);

    expect(await digest(sourcePath)).toBe(sourceDigest);
  });

  it('preserves a pretty-printed snapshot whose payload spans lines', async () => {
    writeSource(sourcePath, [{ hash: evidenceHash, response: prettyResponseJson }]);

    const result = runExporter(sourcePath, exportPath);
    expect(result.status, result.stderr).toBe(0);

    // One row in, one statement out: run it whole instead of through the binding's line-based exec().
    const statement = (await readFile(exportPath, 'utf8')).trim();
    const target = await openTarget('d1');
    await target.database.prepare(statement).run();

    const imported = await readStored(target, evidenceHash);
    expect(imported?.briefing).toEqual(briefing);
    expect(imported?.text).toBe(prettyResponseJson);
    expect(imported?.createdAt).toBe(storedCreatedAt);
  });

  it('keeps a briefing already stored under the same evidence hash', async () => {
    const winner = { ...briefing, model: 'already-paid-for-model' };
    const winnerCreatedAt = '2026-09-19T08:30:00Z';
    const target = await openTarget('d1');
    await target.database
      .prepare('INSERT INTO package_briefings (evidence_hash, response_json, created_at) VALUES (?, ?, ?)')
      .bind(evidenceHash, JSON.stringify(winner), winnerCreatedAt)
      .run();

    writeSource(sourcePath, [{ hash: evidenceHash, response: responseJson }]);
    const result = runExporter(sourcePath, exportPath);
    expect(result.status, result.stderr).toBe(0);
    await target.database.exec(await readFile(exportPath, 'utf8'));

    expect(await readStored(target, evidenceHash)).toEqual({
      text: JSON.stringify(winner),
      createdAt: winnerCreatedAt,
      briefing: winner,
    });
  });

  it('publishes nothing when a later stored row is invalid', async () => {
    // The valid row sorts first, so a partial export written before the invalid row is detected.
    const hashes: [string, string] = [
      createHash('sha256').update('valid snapshot').digest('hex'),
      createHash('sha256').update('invalid snapshot').digest('hex'),
    ];
    hashes.sort();
    const [earlyHash, lateHash] = hashes;
    const validRow: StoredRow = { hash: earlyHash, response: responseJson };
    const malformed: readonly { reason: string; rows: readonly StoredRow[] }[] = [
      {
        reason: 'not a lowercase SHA-256 key',
        // Any hex key sorts before `not-a-sha`.
        rows: [validRow, { hash: 'not-a-sha', response: responseJson }],
      },
      {
        reason: 'not JSON text',
        rows: [validRow, { hash: lateHash, response: "{ 'status': 'available' }" }],
      },
      {
        reason: 'not an available briefing',
        rows: [
          validRow,
          {
            hash: lateHash,
            response: JSON.stringify({ status: 'unavailable', reason: 'timeout', bullets: [], sources: [] }),
          },
        ],
      },
    ];

    for (const { reason, rows } of malformed) {
      await rm(sourcePath, { force: true });
      writeSource(sourcePath, rows);
      const sourceDigest = await digest(sourcePath);

      const result = runExporter(sourcePath, exportPath);
      expect(result.status, `${reason}: ${result.stderr}`).not.toBe(0);
      expect(await readdir(directory), reason).toEqual(['briefings.db']);
      expect(await digest(sourcePath), reason).toBe(sourceDigest);
    }
  });

  it('never replaces an output file that already exists', async () => {
    writeSource(sourcePath, [{ hash: evidenceHash, response: responseJson }]);
    await writeFile(exportPath, 'SELECT 1;\n');

    const result = runExporter(sourcePath, exportPath);
    expect(result.status, result.stderr).not.toBe(0);
    expect(await readFile(exportPath, 'utf8')).toBe('SELECT 1;\n');
    expect((await readdir(directory)).sort()).toEqual(['briefings-export.sql', 'briefings.db']);
  });
});
