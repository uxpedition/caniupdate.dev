import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Data, Effect, Schema, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { PRIVATE_CI_KEYS } from '../deploy/configurationKeys.ts';

class CiRunFailure extends Data.TaggedError('CiRunFailure')<{
  readonly message: string;
}> {}

const CiEnvironmentSchema = Schema.Struct({
  SMOKE_BROWSER: Schema.Union([Schema.Literal('chromium'), Schema.Literal('firefox')]),
  SMOKE_TARGET: Schema.Literal('stage'),
});

const runCommand = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  failureMessage: string,
): Effect.Effect<number, CiRunFailure, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function* () {
    const childProcess = yield* ChildProcess.make('nub', args, {
      env: environment,
      extendEnv: false,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).pipe(Effect.mapError(() => new CiRunFailure({ message: failureMessage })));

    return yield* childProcess.exitCode.pipe(Effect.mapError(() => new CiRunFailure({ message: failureMessage })));
  });

const program: Effect.Effect<void, CiRunFailure, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> = Effect.gen(
  function* () {
    const environment = yield* Schema.decodeUnknownEffect(CiEnvironmentSchema, {
      errors: 'all',
      onExcessProperty: 'ignore',
    })(
      yield* Effect.sync(() => ({
        SMOKE_BROWSER: process.env['SMOKE_BROWSER'],
        SMOKE_TARGET: process.env['SMOKE_TARGET'],
      })),
    ).pipe(
      Effect.mapError(
        () => new CiRunFailure({ message: 'Stage browser verification requires a supported browser and target.' }),
      ),
    );

    const childEnvironment: NodeJS.ProcessEnv = { ...process.env };

    for (const key of PRIVATE_CI_KEYS) {
      if (key !== 'CF_ACCESS_CLIENT_ID' && key !== 'CF_ACCESS_CLIENT_SECRET') delete childEnvironment[key];
    }

    const install = yield* runCommand(
      ['exec', 'playwright', 'install', '--with-deps', environment.SMOKE_BROWSER],
      childEnvironment,
      'Browser runtime installation failed.',
    );

    if (install !== 0) return yield* Effect.fail(new CiRunFailure({ message: 'Browser runtime installation failed.' }));

    const smoke = yield* runCommand(
      ['run', 'smoke:deployed'],
      childEnvironment,
      'Deployed browser verification failed.',
    );

    if (smoke !== 0) return yield* Effect.fail(new CiRunFailure({ message: 'Deployed browser verification failed.' }));
  },
);

const workflow = Effect.matchEffect(program, {
  onFailure: (failure) =>
    Effect.sync(() => {
      process.stderr.write(`${failure.message}\n`);
      process.exitCode = 1;
    }),
  onSuccess: () => Effect.void,
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(workflow);
