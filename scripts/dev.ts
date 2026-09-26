// The local launcher: one supervisor for the three runtimes the application now needs.
//
// - the private evidence Worker on 8790 (its Durable Object namespace owns the shared provider evidence),
// - the private briefing Worker on 8791 (its D1 database and job Durable Objects own generation and snapshots),
// - the frontend on 5173: Nuxt with HMR, or the built Worker from `.output/server/wrangler.json` under `--preview`.
//
// The migration runs against the briefing Worker's configuration, because that is the only local owner of the D1
// database. Every Wrangler session is pointed at one persistence root, so the D1 and Durable Object state survive a
// build and a restart; a lock in that root refuses a second launcher (for example `preview` beside `dev`) that would
// otherwise own the same state concurrently. Ctrl-C, or any child failing, stops all three processes.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Deferred, Effect, PlatformError, Scope, Stream, Data } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

import { browserOrigins } from './browserOrigins.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const nuxt = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const DEFAULT_PERSIST_TO = '.wrangler/state';
const DEFAULT_EVIDENCE_PORT = 8790;
const DEFAULT_BRIEFING_PORT = 8791;
const DEFAULT_FRONTEND_PORT = 5173;
/** One inspector port per session: the three Wrangler sessions may not compete for Wrangler's default. */
const DEFAULT_INSPECTOR_BASE = 9230;
const STATE_LOCK_FILE = 'launcher.lock';

const USAGE =
  'Usage: node scripts/dev.ts [--preview] [--persist-to <dir>] [--evidence-port <port>] [--briefing-port <port>] ' +
  '[--frontend-port <port>] [--inspector-base <port>]';

class UsageError extends Data.TaggedError('UsageError')<{
  readonly message: string;
}> {}

class StateInUseError extends Data.TaggedError('StateInUseError')<{
  readonly message: string;
}> {}

class StateLockFailedError extends Data.TaggedError('StateLockFailedError')<{
  readonly message: string;
}> {}

class MigrationFailedError extends Data.TaggedError('MigrationFailedError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

class BackendWorkerFailedError extends Data.TaggedError('BackendWorkerFailedError')<{
  readonly worker: string;
  readonly exitCode: number;
  readonly message: string;
}> {}

class BackendWorkerExitError extends Data.TaggedError('BackendWorkerExitError')<{
  readonly worker: string;
  readonly exitCode: number;
  readonly message: string;
}> {}

class NuxtExitError extends Data.TaggedError('NuxtExitError')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

type Options = {
  readonly preview: boolean;
  readonly persistTo: string;
  readonly evidencePort: number;
  readonly briefingPort: number;
  readonly frontendPort: number;
  /** The first of three consecutive inspector ports, one per session. */
  readonly inspectorBase: number;
};

const parsePort = (flag: string, value: string | undefined): number => {
  const port = Number(value);
  if (value === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UsageError({ message: `${flag} expects a TCP port, got ${JSON.stringify(value)}\n${USAGE}` });
  }
  return port;
};

/**
 * The defaults are the documented local ports and `.wrangler/state`; the overrides exist so an isolated probe (the
 * smoke scenario, a fault test) can run beside a live development session without touching its state or its ports.
 */
const parseOptions = (argv: readonly string[]): Options => {
  let preview = false;
  let persistTo = DEFAULT_PERSIST_TO;
  let evidencePort = DEFAULT_EVIDENCE_PORT;
  let briefingPort = DEFAULT_BRIEFING_PORT;
  let frontendPort = DEFAULT_FRONTEND_PORT;
  let inspectorBase = DEFAULT_INSPECTOR_BASE;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--preview':
        preview = true;
        break;
      case '--persist-to': {
        index += 1;
        const value = argv[index];
        if (value === undefined || value.trim() === '') {
          throw new UsageError({ message: `--persist-to expects a directory\n${USAGE}` });
        }
        persistTo = value;
        break;
      }
      case '--evidence-port':
        index += 1;
        evidencePort = parsePort('--evidence-port', argv[index]);
        break;
      case '--briefing-port':
        index += 1;
        briefingPort = parsePort('--briefing-port', argv[index]);
        break;
      case '--frontend-port':
        index += 1;
        frontendPort = parsePort('--frontend-port', argv[index]);
        break;
      case '--inspector-base':
        index += 1;
        inspectorBase = parsePort('--inspector-base', argv[index]);
        break;
      default:
        throw new UsageError({ message: `Unknown argument ${JSON.stringify(flag)}\n${USAGE}` });
    }
  }

  return { preview, persistTo, evidencePort, briefingPort, frontendPort, inspectorBase };
};

const options: Effect.Effect<Options, UsageError> = Effect.try({
  try: () => parseOptions(process.argv.slice(2)),
  catch: (error) => (error instanceof UsageError ? error : new UsageError({ message: String(error) })),
});

const applyMigrationsCommand = (launch: Options) =>
  ChildProcess.make(
    process.execPath,
    [
      wrangler,
      'd1',
      'migrations',
      'apply',
      'BRIEFINGS_DB',
      '--local',
      '--config',
      'workers/briefing/wrangler.jsonc',
      '--persist-to',
      launch.persistTo,
    ],
    { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', forceKillAfter: '5 seconds' },
  );

const evidenceWorkerCommand = (launch: Options) =>
  ChildProcess.make(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--config',
      'workers/evidence/wrangler.jsonc',
      '--persist-to',
      launch.persistTo,
      '--port',
      String(launch.evidencePort),
      '--inspector-port',
      String(launch.inspectorBase),
    ],
    {
      cwd: root,
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'inherit',
      forceKillAfter: '5 seconds',
    },
  );

/**
 * The socket URL and the accepted Origins are derived from the ports this launcher actually chose, so an overridden
 * port cannot hand the browser a URL nothing listens on. The accepted Origins are every hostname the page is served
 * on, not just loopback: the README opens the page from another device by this machine's own address.
 *
 * `--ip 0.0.0.0` publishes the socket on those addresses too, because a loopback-bound Worker is unreachable from the
 * device that loaded the page. The advertised URL itself stays loopback instead of guessing an address: no startup-time
 * choice knows which address that device used, so the submission route re-points it at the host each request arrived on.
 */
const briefingWorkerCommand = (launch: Options) =>
  ChildProcess.make(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--config',
      'workers/briefing/wrangler.jsonc',
      '--persist-to',
      launch.persistTo,
      '--ip',
      '0.0.0.0',
      '--port',
      String(launch.briefingPort),
      '--inspector-port',
      String(launch.inspectorBase + 1),
      '--var',
      `BRIEFING_PUBLIC_URL:ws://localhost:${launch.briefingPort}`,
      '--var',
      `BRIEFING_ALLOWED_ORIGIN:${browserOrigins(launch.frontendPort).join(',')}`,
    ],
    {
      cwd: root,
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'inherit',
      forceKillAfter: '5 seconds',
    },
  );

const frontendCommand = (launch: Options) =>
  launch.preview
    ? ChildProcess.make(
        process.execPath,
        [
          wrangler,
          'dev',
          '--local',
          '--config',
          '.output/server/wrangler.json',
          '--persist-to',
          launch.persistTo,
          '--ip',
          '0.0.0.0',
          '--port',
          String(launch.frontendPort),
          '--inspector-port',
          String(launch.inspectorBase + 2),
        ],
        {
          cwd: root,
          stdin: 'inherit',
          stdout: 'pipe',
          stderr: 'inherit',
          forceKillAfter: '5 seconds',
        },
      )
    : ChildProcess.make(process.execPath, [nuxt, 'dev', '--host', '0.0.0.0', '--port', String(launch.frontendPort)], {
        cwd: root,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        forceKillAfter: '5 seconds',
      });

const applyMigrations: (
  launch: Options,
) => Effect.Effect<
  void,
  PlatformError.PlatformError | MigrationFailedError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> = (launch) =>
  Effect.gen(function* () {
    const migrationChild = yield* applyMigrationsCommand(launch);

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

const lockPathFor = (persistTo: string): string => `${persistTo.replace(/\/+$/, '')}/${STATE_LOCK_FILE}`;

/** A zero-signal probe: `ESRCH` means the recorded owner is gone and its lock is stale. */
const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

type LockHolder = { readonly pid?: number; readonly mode?: string };

/** A malformed or empty lock is treated as a stale one: only a readable pid can claim the root. */
const readLockHolder = async (lockPath: string): Promise<LockHolder | undefined> => {
  const contents = await readFile(lockPath, 'utf8').catch(() => undefined);
  if (contents === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const holder: { -readonly [K in keyof LockHolder]: LockHolder[K] } = {};
  if ('pid' in parsed && typeof parsed.pid === 'number') holder.pid = parsed.pid;
  if ('mode' in parsed && typeof parsed.mode === 'string') holder.mode = parsed.mode;
  return holder;
};

/**
 * Refuse to start when another launcher already owns this persistence root: two Wrangler sessions must never own the
 * same local D1 database and Durable Object storage. A lock whose process is gone is stale and is taken over.
 */
const acquireStateLock = (launch: Options) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const lockPath = lockPathFor(launch.persistTo);
        const holder = await readLockHolder(lockPath);
        if (holder !== undefined && typeof holder.pid === 'number' && processIsAlive(holder.pid)) {
          throw new StateInUseError({
            message:
              `Another launcher (${holder.mode ?? 'unknown'}, pid ${holder.pid}) already owns ${launch.persistTo}. ` +
              'Stop it first: dev and preview must not own the same local state concurrently.',
          });
        }
        await mkdir(dirname(lockPath), { recursive: true });
        await writeFile(lockPath, JSON.stringify({ pid: process.pid, mode: launch.preview ? 'preview' : 'dev' }));
      },
      catch: (error) =>
        error instanceof StateInUseError
          ? error
          : new StateLockFailedError({
              message: `Could not take the launcher lock in ${launch.persistTo}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            }),
    }),
    () =>
      Effect.promise(async () => {
        const lockPath = lockPathFor(launch.persistTo);
        const holder = await readLockHolder(lockPath);
        if (holder?.pid === process.pid) await rm(lockPath, { force: true });
      }).pipe(Effect.orElseSucceed(() => undefined)),
  );

type WorkerHandle = {
  readonly name: string;
  readonly childProcess: ChildProcessSpawner.ChildProcessHandle;
  readonly readySignal: Deferred.Deferred<void>;
};

const followWorkerOutput = (worker: WorkerHandle, backendReadySignal: Deferred.Deferred<void>) => {
  let recentOutput = '';

  return Stream.runForEach(worker.childProcess.stdout.pipe(Stream.decodeText), (text) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        process.stdout.write(text);
        recentOutput = (recentOutput + text).slice(-4096);
      });

      if (/Ready on https?:\/\//.test(recentOutput)) {
        const firstTime = yield* Deferred.succeed(backendReadySignal, undefined);

        if (firstTime) {
          yield* Effect.log(`${worker.name} is ready`);
        }
      }
    }),
  );
};

const waitForWorkerReadiness = (worker: WorkerHandle) =>
  Effect.raceFirst(
    Deferred.await(worker.readySignal),
    worker.childProcess.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Effect.fail(
          new BackendWorkerFailedError({
            worker: worker.name,
            exitCode,
            message: `${worker.name} exited before readiness with code ${exitCode}`,
          }),
        ),
      ),
    ),
  ).pipe(Effect.timeout('30 seconds'));

const startWorker = (name: string, command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const childProcess = yield* command;

    yield* Effect.log(`${name} child PID: ${childProcess.pid}`);

    const readySignal = yield* Deferred.make<void>();

    const worker: WorkerHandle = { name, childProcess, readySignal };

    yield* followWorkerOutput(worker, readySignal).pipe(Effect.forkScoped);

    return worker;
  });

const waitForAnyChildProcessToStop = (workers: readonly WorkerHandle[], frontend: WorkerHandle) =>
  Effect.raceAllFirst([
    ...workers.map((worker) =>
      worker.childProcess.exitCode.pipe(
        Effect.flatMap((exitCode) =>
          Effect.fail(
            new BackendWorkerExitError({
              worker: worker.name,
              exitCode,
              message: `${worker.name} stopped with code ${exitCode}`,
            }),
          ),
        ),
      ),
    ),
    frontend.childProcess.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Effect.fail(new NuxtExitError({ exitCode, message: `${frontend.name} stopped with code ${exitCode}` })),
      ),
    ),
  ]);

const program = Effect.gen(function* () {
  const launch = yield* options;

  yield* Effect.log(
    `${launch.preview ? 'Preview: the built frontend' : 'Development: Nuxt HMR'} on ${launch.frontendPort}, ` +
      `evidence ${launch.evidencePort}, briefing ${launch.briefingPort}, state ${launch.persistTo}`,
  );

  yield* acquireStateLock(launch);

  yield* applyMigrations(launch);

  const evidenceWorker = yield* startWorker('Evidence worker', evidenceWorkerCommand(launch));
  const briefingWorker = yield* startWorker('Briefing worker', briefingWorkerCommand(launch));

  yield* Effect.all([waitForWorkerReadiness(evidenceWorker), waitForWorkerReadiness(briefingWorker)], {
    concurrency: 'unbounded',
  });

  yield* Effect.log('Both private Workers are ready');

  const frontend = yield* startWorker('Frontend', frontendCommand(launch));

  yield* waitForAnyChildProcessToStop([evidenceWorker, briefingWorker], frontend);
});

const runnable = program.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(runnable);
