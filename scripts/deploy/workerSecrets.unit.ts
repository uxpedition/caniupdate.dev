import { access } from 'node:fs/promises';
import { dirname } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { describe, expect, it } from 'vitest';

import { withWorkerSecrets } from './workerSecrets.ts';

describe('deployment secret-file lifetime', () => {
  it('keeps files owner-only and removes the directory even when deployment fails', async () => {
    let secretPath = '';
    const uploadFailure = new Error('fixture upload failure');

    const program = withWorkerSecrets({ AI_BRIEFING_API_KEY: 'fixture-only-key' }, (path) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        secretPath = path;
        expect((yield* fs.stat(path)).mode & 0o077).toBe(0);
        expect((yield* fs.stat(dirname(path))).mode & 0o077).toBe(0);

        return yield* Effect.fail(uploadFailure);
      }),
    );

    await expect(Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)))).rejects.toBe(uploadFailure);
    await expect(access(secretPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(dirname(secretPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
