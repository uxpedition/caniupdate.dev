import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { copyPrivateKeyForSsh } from './gitlabTagPush.ts';

const FIXTURE_PRIVATE_KEY = 'synthetic private-key fixture; not a credential\n';

describe('GitLab release SSH key staging', () => {
  it('stages a runner file-variable key with owner-only permissions', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'can-i-update-key-permissions-'));
    const sourcePath = resolve(directory, 'runner-file-variable');
    const sshDirectory = resolve(directory, 'ssh');

    try {
      await mkdir(sshDirectory, { mode: 0o700 });
      await writeFile(sourcePath, FIXTURE_PRIVATE_KEY, { mode: 0o600 });
      await chmod(sourcePath, 0o644);

      const stagedKeyPath = await Effect.runPromise(copyPrivateKeyForSsh(sourcePath, sshDirectory));

      expect(await stat(sourcePath).then((file) => file.mode & 0o777)).toBe(0o644);
      expect(await stat(stagedKeyPath).then((file) => file.mode & 0o777)).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
