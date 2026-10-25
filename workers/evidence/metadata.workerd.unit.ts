import { setTimeout as delay } from 'node:timers/promises';

import { Response } from 'miniflare';
import { describe, expect, it } from 'vitest';

import { openMetadataFixture } from './test/metadata.harness';

const metadata = (versions = ['1.2.3', '2.1.0']) => ({
  name: '@scope/example',
  modified: '2026-10-01',
  'dist-tags': {},
  versions: Object.fromEntries(
    versions.map((version) => [
      version,
      {
        name: '@scope/example',
        version,
        dist: { tarball: 'https://registry.npmjs.org/fixture.tgz', shasum: 'abc' },
      },
    ]),
  ),
});

describe('shared package metadata in production PackageEvidence', () => {
  it('persists successful metadata for thirty minutes across restarts and refreshes expired entries', async () => {
    let calls = 0;

    const fixture = await openMetadataFixture(async (request) => {
      expect(request.url).toBe('https://registry.npmjs.org/%40scope%2Fexample');
      calls += 1;

      return Response.json(metadata(calls === 1 ? ['1.2.3'] : ['1.2.3', '2.1.0']));
    });

    try {
      const before = Date.now();
      expect((await fixture.request()).status).toBe(200);
      const after = Date.now();
      const storage = await fixture.storage();
      const rows = await storage.exec('SELECT expires_at FROM evidence_records');
      expect(rows[0]?.expires_at).toBeGreaterThanOrEqual(before + 1_800_000);
      expect(rows[0]?.expires_at).toBeLessThanOrEqual(after + 1_800_000);
      await fixture.restart();
      expect(await (await fixture.request()).json()).toMatchObject({ versions: ['1.2.3'] });
      expect(calls).toBe(1);
      await (await fixture.storage()).exec('UPDATE evidence_records SET expires_at = ?', Date.now());
      expect(await (await fixture.request()).json()).toMatchObject({ versions: ['2.1.0', '1.2.3'] });
      expect(calls).toBe(2);
    } finally {
      await fixture.dispose();
    }
  }, 120_000);

  it('shares concurrent cache misses and never caches failures or malformed identities', async () => {
    let calls = 0;
    const { promise: started, resolve: entered } = Promise.withResolvers<void>();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();

    const fixture = await openMetadataFixture(async () => {
      calls += 1;

      if (calls === 1) {
        entered();
        await gate;

        return new Response('private-provider-marker', { status: 429 });
      }

      if (calls === 2) return Response.json({ ...metadata(), name: 'wrong-package' });

      return Response.json(metadata());
    });

    try {
      const first = fixture.request();
      await started;
      const second = fixture.request();
      // Wait for the second request to reach the DO before releasing shared provider work.
      await delay(50);
      release();
      const failures = await Promise.all([first, second]);
      expect(failures.map((response) => response.status)).toEqual([503, 503]);
      expect(calls).toBe(1);
      expect(await failures[0]?.text()).not.toContain('private-provider-marker');
      expect((await fixture.request()).status).toBe(503);
      expect((await fixture.request()).status).toBe(200);
      expect((await fixture.request()).status).toBe(200);
      expect(calls).toBe(3);
    } finally {
      release();
      await fixture.dispose();
    }
  }, 120_000);
  it('rejects invalid input before provider work and fails closed on corrupt stored metadata', async () => {
    let calls = 0;

    const fixture = await openMetadataFixture(async () => {
      calls += 1;

      return Response.json(metadata());
    });

    try {
      expect((await fixture.request({ packageName: '../escape' })).status).toBe(400);
      expect(calls).toBe(0);
      expect((await fixture.request()).status).toBe(200);
      const storage = await fixture.storage();
      await storage.exec("UPDATE evidence_chunks SET payload = 'null'");
      expect((await fixture.request()).status).toBe(503);
      expect(calls).toBe(1);
    } finally {
      await fixture.dispose();
    }
  }, 120_000);
});
