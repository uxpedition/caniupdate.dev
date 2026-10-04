import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { installBriefingSchema, openBriefingD1, type BriefingD1 } from '../../../test/helpers/briefingDatabase.harness';
import { BriefingStoreError, BriefingStoreValidationError, readStoredBriefing, saveBriefing } from './store';

const briefing = {
  status: 'available' as const,
  model: 'test-model',
  bullets: [{ kind: 'coverage' as const, basis: 'fact' as const, text: 'Coverage is limited.', evidenceNumbers: [0] }],
  sources: [{ number: 0, id: 'coverage', kind: 'coverage' as const, label: 'Coverage', urls: [], text: '{}' }],
};

let directory: string;
let runtime: BriefingD1 | undefined;

// Miniflare startup dominates this suite, so every test shares one runtime and an explicitly emptied table.
function database() {
  if (runtime === undefined) throw new Error('D1 setup failed');
  return runtime.database;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'briefing-store-'));
  runtime = await openBriefingD1(directory);
});

beforeEach(async () => {
  await database().prepare('DELETE FROM package_briefings').run();
});

afterAll(async () => {
  await runtime?.dispose();
  runtime = undefined;
  await rm(directory, { recursive: true, force: true });
});

describe('package briefing store', () => {
  it('preserves one canonical success across competing writes', async () => {
    const alternative = { ...briefing, model: 'another-model' };
    const results = await Promise.all([
      saveBriefing(database(), 'same-evidence', briefing),
      saveBriefing(database(), 'same-evidence', alternative),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect([briefing, alternative]).toContainEqual(results[0]);
    expect(await readStoredBriefing(database(), 'same-evidence')).toEqual(results[0]);
  });

  it('rejects runtime-invalid briefings before writing a row', async () => {
    const invalid = {
      ...briefing,
      bullets: briefing.bullets.map((bullet) => ({ ...bullet, evidenceNumbers: [1.5] })),
    };

    const failure = await saveBriefing(database(), 'invalid-evidence', invalid).catch((cause: unknown) => cause);
    if (!(failure instanceof BriefingStoreValidationError)) throw new Error('Expected a tagged validation failure');
    expect(failure.cause).toBeInstanceOf(Error);
    await expect(
      database()
        .prepare('SELECT response_json FROM package_briefings WHERE evidence_hash = ?')
        .bind('invalid-evidence')
        .first(),
    ).resolves.toBeNull();
  });

  it('preserves the cause when a D1 insert fails', async () => {
    await database()
      .prepare(
        "CREATE TRIGGER reject_briefing_insert BEFORE INSERT ON package_briefings BEGIN SELECT RAISE(FAIL, 'briefing insert refused'); END;",
      )
      .run();
    try {
      const failure = await saveBriefing(database(), 'rejected-evidence', briefing).catch((cause: unknown) => cause);
      if (!(failure instanceof BriefingStoreError)) throw new Error('Expected a tagged storage failure');
      expect(failure.operation).toBe('write');
      expect(failure.cause).toBeInstanceOf(Error);
    } finally {
      await database().prepare('DROP TRIGGER reject_briefing_insert').run();
    }
  });

  it('rejects a corrupt saved result instead of treating it as a miss', async () => {
    await expect(readStoredBriefing(database(), 'missing-evidence')).resolves.toBeUndefined();
    await database()
      .prepare('INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?)')
      .bind('corrupt-evidence', '{')
      .run();

    await expect(readStoredBriefing(database(), 'corrupt-evidence')).rejects.toMatchObject({
      _tag: 'BriefingStoreCorruptionError',
    });
    // A valid neighbour still decodes, so the rejection is the corrupt row rather than a broken binding.
    await saveBriefing(database(), 'valid-evidence', briefing);
    expect(await readStoredBriefing(database(), 'valid-evidence')).toEqual(briefing);
  });

  it('distinguishes a D1 operation failure from an absent row', async () => {
    await database().prepare('DROP TABLE package_briefings').run();
    try {
      await expect(readStoredBriefing(database(), 'missing-evidence')).rejects.toMatchObject({
        _tag: 'BriefingStoreError',
        operation: 'read',
      });
    } finally {
      await installBriefingSchema(database());
    }
  });

  it('retains an old success when a later snapshot is saved', async () => {
    await saveBriefing(database(), 'old-evidence', briefing);
    const changed = { ...briefing, model: 'changed-evidence-model' };
    await saveBriefing(database(), 'new-evidence', changed);

    expect(await readStoredBriefing(database(), 'old-evidence')).toEqual(briefing);
    expect(await readStoredBriefing(database(), 'new-evidence')).toEqual(changed);
  });
});
