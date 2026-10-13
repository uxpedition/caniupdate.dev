import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateLocalState } from './localState';

const roots: string[] = [];

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-state-'));
  roots.push(root);

  return root;
};

const store = async (root: string, path: string, content: string) => {
  const directory = join(root, path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'database.sqlite'), content);
  await writeFile(join(directory, 'database.sqlite-wal'), `${content}-wal`);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local state cutover', () => {
  it('preserves D1, evidence, job databases and their journals across cutover and restart', async () => {
    const root = await fixture();

    const stores = [
      ['d1', 'briefing', 'settled briefing'],
      ['do/can-i-update-local-evidence-PackageEvidence', 'evidence', 'cached evidence'],
      ['do/can-i-update-local-briefing-BriefingJob', 'briefing', 'job generation'],
    ] as const;

    for (const [path, , content] of stores) await store(root, `v3/${path}`, content);
    await migrateLocalState(root);
    await migrateLocalState(root);

    for (const [path, owner, content] of stores) {
      expect(await readFile(join(root, owner, 'v3', path, 'database.sqlite'), 'utf8')).toBe(content);
      expect(await readFile(join(root, owner, 'v3', path, 'database.sqlite-wal'), 'utf8')).toBe(`${content}-wal`);
      await expect(access(join(root, 'v3', path))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('refuses conflicting old and new stores before moving any data', async () => {
    const root = await fixture();
    await store(root, 'v3/d1', 'old result');
    await store(root, 'briefing/v3/d1', 'new result');
    await store(root, 'v3/do/can-i-update-local-evidence-PackageEvidence', 'evidence');
    await expect(migrateLocalState(root)).rejects.toThrow('both');
    expect(await readFile(join(root, 'v3/d1/database.sqlite'), 'utf8')).toBe('old result');
    expect(await readFile(join(root, 'briefing/v3/d1/database.sqlite'), 'utf8')).toBe('new result');
    expect(
      await readFile(join(root, 'v3/do/can-i-update-local-evidence-PackageEvidence/database.sqlite'), 'utf8'),
    ).toBe('evidence');
  });

  it('resumes a partial cutover without touching already moved or unrelated state', async () => {
    const root = await fixture();
    await store(root, 'briefing/v3/d1', 'moved result');
    await store(root, 'v3/do/can-i-update-local-evidence-PackageEvidence', 'remaining evidence');
    await store(root, 'v3/do/unrelated-worker', 'unrelated data');
    await migrateLocalState(root);
    expect(await readFile(join(root, 'briefing/v3/d1/database.sqlite'), 'utf8')).toBe('moved result');
    expect(
      await readFile(join(root, 'evidence/v3/do/can-i-update-local-evidence-PackageEvidence/database.sqlite'), 'utf8'),
    ).toBe('remaining evidence');
    expect(await readFile(join(root, 'v3/do/unrelated-worker/database.sqlite'), 'utf8')).toBe('unrelated data');
  });
});
