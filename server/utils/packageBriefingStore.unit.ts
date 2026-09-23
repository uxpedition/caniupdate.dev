import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openBriefingD1, type BriefingD1 } from '../../test/helpers/briefingD1';
import { readStoredBriefing, saveBriefing } from './packageBriefingStore';

const briefing = {
  status: 'available' as const,
  model: 'test-model',
  bullets: [
    { kind: 'coverage' as const, basis: 'fact' as const, text: 'Coverage is limited.', evidenceIds: ['coverage'] },
  ],
  sources: [{ id: 'coverage', kind: 'coverage' as const, label: 'Coverage', urls: [], text: '{}' }],
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

  it('rejects a corrupt saved result instead of treating it as a miss', async () => {
    await database()
      .prepare('INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?)')
      .bind('corrupt-evidence', '{')
      .run();

    await expect(readStoredBriefing(database(), 'corrupt-evidence')).rejects.toBeDefined();
    // A valid neighbour still decodes, so the rejection is the corrupt row rather than a broken binding.
    await saveBriefing(database(), 'valid-evidence', briefing);
    expect(await readStoredBriefing(database(), 'valid-evidence')).toEqual(briefing);
  });

  it('retains an old success when a later snapshot is saved', async () => {
    await saveBriefing(database(), 'old-evidence', briefing);
    const changed = { ...briefing, model: 'changed-evidence-model' };
    await saveBriefing(database(), 'new-evidence', changed);

    expect(await readStoredBriefing(database(), 'old-evidence')).toEqual(briefing);
    expect(await readStoredBriefing(database(), 'new-evidence')).toEqual(changed);
  });
});
