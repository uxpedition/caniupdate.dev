import { join } from 'node:path';

import { Data, Effect, FileSystem } from 'effect';

import type { WorkerSecrets } from './runtimeSettings.ts';

export class WorkerSecretsFailure extends Data.TaggedError('WorkerSecretsFailure')<{
  readonly message: string;
}> {}

export function withWorkerSecrets<A, E, R>(
  secrets: WorkerSecrets,
  deploy: (path: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, WorkerSecretsFailure | E, FileSystem.FileSystem | R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs
        .makeTempDirectoryScoped({ prefix: 'can-i-update-worker-secrets-' })
        .pipe(
          Effect.mapError(
            () => new WorkerSecretsFailure({ message: 'Worker deployment secrets could not be prepared' }),
          ),
        );
      const path = join(directory, 'secrets.json');

      yield* fs
        .chmod(directory, 0o700)
        .pipe(
          Effect.mapError(
            () => new WorkerSecretsFailure({ message: 'Worker deployment secrets could not be prepared' }),
          ),
        );
      yield* fs
        .writeFileString(path, JSON.stringify(secrets), { mode: 0o600 })
        .pipe(
          Effect.mapError(
            () => new WorkerSecretsFailure({ message: 'Worker deployment secrets could not be prepared' }),
          ),
        );

      return yield* deploy(path);
    }),
  );
}
