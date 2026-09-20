import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@libsql/client/sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeBriefingStore, saveBriefing } from './packageBriefingStore';

const briefing = {
  status: 'available' as const,
  model: 'test-model',
  bullets: [
    { kind: 'coverage' as const, basis: 'fact' as const, text: 'Coverage is limited.', evidenceIds: ['coverage'] },
  ],
  sources: [{ id: 'coverage', kind: 'coverage' as const, label: 'Coverage', urls: [], text: '{}' }],
};

let directory: string;
let path: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'briefing-store-'));
  path = join(directory, 'briefings.db');
  process.env.AI_BRIEFING_CACHE_PATH = path;
});

afterEach(async () => {
  closeBriefingStore();
  delete process.env.AI_BRIEFING_CACHE_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe('package briefing store', () => {
  it('waits for another local writer and preserves the successful response', async () => {
    await saveBriefing('seed', briefing);
    const lockClient = createClient({ url: `file:${path}`, timeout: 1000 });
    const lock = await lockClient.transaction('write');
    await lock.execute({
      sql: 'INSERT INTO package_briefings (evidence_hash, response_json) VALUES (?, ?)',
      args: ['held', '{}'],
    });

    const pending = saveBriefing('target', briefing);
    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 50);
    await delay.promise;
    await lock.commit();
    lock.close();
    await expect(pending).resolves.toEqual(briefing);
    lockClient.close();
  });
});
