import { access, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withWorkerSecrets } from './workerSecrets.ts';

describe('deployment secret-file lifetime', () => {
  it('keeps files owner-only and removes the directory even when deployment fails', async () => {
    let secretPath = '';
    const uploadFailure = new Error('fixture upload failure');

    await expect(
      withWorkerSecrets({ AI_BRIEFING_API_KEY: 'fixture-only-key' }, async (path) => {
        secretPath = path;
        expect((await stat(path)).mode & 0o077).toBe(0);
        expect((await stat(dirname(path))).mode & 0o077).toBe(0);
        throw uploadFailure;
      }),
    ).rejects.toBe(uploadFailure);

    await expect(access(secretPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(dirname(secretPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
