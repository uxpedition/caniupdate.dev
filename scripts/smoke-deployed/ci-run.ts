import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Data, Effect, Schema, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { PRIVATE_CI_KEYS } from '../deploy/configurationKeys.ts';

class CiRunFailure extends Data.TaggedError('CiRunFailure')<{
  readonly message: string;
}> {}

const CiEnvironmentSchema = Schema.Struct({
  SMOKE_TARGET: Schema.Union([Schema.Literal('stage'), Schema.Literal('production')]),
});

const program: Effect.Effect<void, CiRunFailure, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> = Effect.gen(
  function* () {
    const environment = yield* Schema.decodeUnknownEffect(CiEnvironmentSchema, {
      errors: 'all',
      onExcessProperty: 'ignore',
    })(
      yield* Effect.sync(() => ({
        SMOKE_TARGET: process.env['SMOKE_TARGET'],
      })),
    ).pipe(
      Effect.mapError(
        () =>
          new CiRunFailure({
            message: 'Browser verification requires a supported deployment target.',
          }),
      ),
    );

    const childEnvironment: NodeJS.ProcessEnv = { ...process.env };

    for (const key of PRIVATE_CI_KEYS) {
      if (
        environment.SMOKE_TARGET !== 'stage' ||
        (key !== 'CF_ACCESS_CLIENT_ID' && key !== 'CF_ACCESS_CLIENT_SECRET')
      ) {
        delete childEnvironment[key];
      }
    }

    const failureMessage = 'Deployed browser verification failed.';

    const childProcess = yield* ChildProcess.make('nub', ['run', 'smoke:deployed'], {
      env: childEnvironment,
      extendEnv: false,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).pipe(Effect.mapError(() => new CiRunFailure({ message: failureMessage })));

    const code = yield* childProcess.exitCode.pipe(
      Effect.mapError(() => new CiRunFailure({ message: failureMessage })),
    );

    if (code !== 0) return yield* Effect.fail(new CiRunFailure({ message: failureMessage }));
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
