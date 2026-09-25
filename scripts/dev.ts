import { fileURLToPath } from 'node:url';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, PlatformError, Scope, Stream, Data } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

const root = fileURLToPath(new URL('..', import.meta.url));
const nuxt = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

class MigrationFailedError extends Data.TaggedError('MigrationFailedError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

class BackendWorkerFailedError extends Data.TaggedError('BackendWorkerFailedError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

class BackendWorkerExitError extends Data.TaggedError('BackendWorkerExitError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

class NuxtExitError extends Data.TaggedError('NuxtExitError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

const applyMigrationsCommand = ChildProcess.make(
  process.execPath,
  [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'BRIEFINGS_DB',
    '--local',
    '--config',
    'wrangler.jsonc',
    '--persist-to',
    '.wrangler/state',
  ],
  { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', forceKillAfter: '5 seconds' },
);
const startWranglerBackendWorkerCommand = ChildProcess.make(
  process.execPath,
  [
    wrangler,
    'dev',
    '--local',
    '--config',
    'workers/evidence/wrangler.jsonc',
    '--persist-to',
    '.wrangler/state',
    '--port',
    '8790',
    '--inspector-port',
    '9230',
  ],
  {
    cwd: root,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'inherit',
    forceKillAfter: '5 seconds',
  },
);
const startNuxtDevServerCommand = ChildProcess.make(
  process.execPath,
  [nuxt, 'dev', '--host', '0.0.0.0', '--port', '5173'],
  {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    forceKillAfter: '5 seconds',
  },
);

const applyMigrations: Effect.Effect<
  void,
  PlatformError.PlatformError | MigrationFailedError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> = Effect.gen(function* () {
  const migrationChild = yield* applyMigrationsCommand;

  const code = yield* migrationChild.exitCode;

  if (code !== 0) {
    return yield* Effect.fail(
      new MigrationFailedError({
        exitCode: code,
        message: `Migrations failed with exit code ${code}`,
      }),
    );
  }

  yield* Effect.log('Migrations completed');
});

const followWorkerOutput = (
  worker: ChildProcessSpawner.ChildProcessHandle,
  backendReadySignal: Deferred.Deferred<void>,
) => {
  let recentOutput = '';

  return Stream.runForEach(worker.stdout.pipe(Stream.decodeText), (text) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        process.stdout.write(text);
        recentOutput = (recentOutput + text).slice(-4096);
      });

      if (/Ready on https?:\/\//.test(recentOutput)) {
        const firstTime = yield* Deferred.succeed(backendReadySignal, undefined);

        if (firstTime) {
          yield* Effect.log('Effect noticed: Worker is ready');
        }
      }
    }),
  );
};

const waitForWorkerReadiness = (
  backendWorkerChildProcess: ChildProcessSpawner.ChildProcessHandle,
  backendReadySignal: Deferred.Deferred<void>,
) =>
  Effect.raceFirst(
    Deferred.await(backendReadySignal),
    backendWorkerChildProcess.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Effect.fail(
          new BackendWorkerFailedError({ exitCode, message: `Worker exited before readiness with code ${exitCode}` }),
        ),
      ),
    ),
  ).pipe(Effect.timeout('30 seconds'));

const startBackendWorker = Effect.gen(function* () {
  const backendWorkerChildProcess = yield* startWranglerBackendWorkerCommand;

  yield* Effect.log(`Backend worker child PID: ${backendWorkerChildProcess.pid}`);

  const backendReadySignal = yield* Deferred.make<void>();

  const outputStream = followWorkerOutput(backendWorkerChildProcess, backendReadySignal);

  yield* outputStream.pipe(Effect.forkScoped);

  yield* waitForWorkerReadiness(backendWorkerChildProcess, backendReadySignal);

  yield* Effect.log('Main fiber knows the Worker is ready');

  return backendWorkerChildProcess;
});

const startNuxtDevServer = Effect.gen(function* () {
  const nuxtChildProcess = yield* startNuxtDevServerCommand;
  yield* Effect.log(`Nuxt child PID: ${nuxtChildProcess.pid}`);

  return nuxtChildProcess;
});

const waitForEitherChildProcessToStop = (
  backendWorkerChildProcess: ChildProcessSpawner.ChildProcessHandle,
  nuxtDevServerChildProcess: ChildProcessSpawner.ChildProcessHandle,
) =>
  Effect.raceFirst(
    backendWorkerChildProcess.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Effect.fail(new BackendWorkerExitError({ exitCode, message: `Worker stopped with code ${exitCode}` })),
      ),
    ),
    nuxtDevServerChildProcess.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Effect.fail(new NuxtExitError({ exitCode, message: `Nuxt stopped with code ${exitCode}` })),
      ),
    ),
  );

const program = Effect.gen(function* () {
  yield* applyMigrations;

  const backendWorkerChildProcess = yield* startBackendWorker;

  const nuxtDevServerChildProcess = yield* startNuxtDevServer;

  yield* waitForEitherChildProcessToStop(backendWorkerChildProcess, nuxtDevServerChildProcess);
});

const runnable = program.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(runnable);
