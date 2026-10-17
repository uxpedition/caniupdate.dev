import { Data, Effect, Exit, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

export class DeploymentFailure extends Data.TaggedError('DeploymentFailure')<{
  readonly message: string;
}> {}

const DeploymentSchema = Schema.Struct({
  type: Schema.Literal('deploy'),
  worker_name: Schema.String,
  version_id: Schema.String,
});

const isDeployment = Schema.is(DeploymentSchema);

/** Effect owns the subprocess lifetime; git output is drained alongside its exit code. */
export function captureCommand(command: string, args: string[]) {
  return Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        forceKillAfter: '5 seconds',
      });
      const [output, status] = yield* Effect.all(
        [child.stdout.pipe(Stream.decodeText(), Stream.runCollect), child.exitCode],
        { concurrency: 'unbounded' },
      ).pipe(Effect.timeout('30 seconds'));

      return status === 0 ? output.join('') : '';
    }),
  ).pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Deployment command failed' })));
}

export function runCommand(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  return Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        env: environment,
        forceKillAfter: '5 seconds',
      });
      const status = yield* child.exitCode;

      if (status !== 0) {
        return yield* Effect.fail(new DeploymentFailure({ message: 'Deployment command failed' }));
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof DeploymentFailure ? error : new DeploymentFailure({ message: 'Deployment command failed' }),
    ),
  );
}

export function assertCurrentMain(commitSha: string, target: 'stage' | 'production') {
  return Effect.gen(function* () {
    const result = yield* Effect.exit(captureCommand('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']));

    if (Exit.isFailure(result) || result.value.trim() !== `${commitSha}\trefs/heads/main`) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: `${target} revision is superseded or main cannot be verified` }),
      );
    }
  });
}

export function assertRemoteReleaseTag(tag: string, commitSha: string) {
  return Effect.gen(function* () {
    const result = yield* Effect.exit(
      captureCommand('git', ['ls-remote', '--exit-code', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]),
    );
    const output = Exit.isFailure(result) ? '' : result.value;
    const refs = output
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/))
      .filter((fields) => fields.length === 2);
    const tagObject = refs.find((fields) => fields[1] === `refs/tags/${tag}`);
    const peeled = refs.find((fields) => fields[1] === `refs/tags/${tag}^{}`);

    if (Exit.isFailure(result) || tagObject === undefined || peeled?.[0] !== commitSha) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: 'Protected annotated release tag does not point to this production commit' }),
      );
    }
  });
}

export function readDeployedVersion(outputFile: string, expectedWorker: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs
      .readFileString(outputFile, 'utf8')
      .pipe(
        Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
      );
    const records = contents.trim().split('\n');
    let versionId: string | undefined;

    for (const line of records) {
      const record = yield* Effect.try({
        try: (): unknown => JSON.parse(line),
        catch: () => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' }),
      });

      if (!isDeployment(record)) continue;

      if (record.worker_name !== expectedWorker) {
        return yield* Effect.fail(new DeploymentFailure({ message: 'Deployment output names an unexpected Worker' }));
      }

      versionId = record.version_id;
    }

    if (!versionId) {
      return yield* Effect.fail(new DeploymentFailure({ message: 'Deployed Worker version was not recorded' }));
    }

    return versionId;
  });
}
