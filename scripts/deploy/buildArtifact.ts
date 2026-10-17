import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { Data, Effect, FileSystem, Schema } from 'effect';

const SHA = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const SHA256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const PIPELINE_ID = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/));

export const BuildArtifactIdentitySchema = Schema.Struct({
  commitSha: SHA,
  pipelineId: PIPELINE_ID,
  bundles: Schema.Struct({ frontend: SHA256, evidence: SHA256, briefing: SHA256 }),
  artifactSha256: SHA256,
});

export type BuildArtifactIdentity = typeof BuildArtifactIdentitySchema.Type;

export type WorkerBundleName = keyof BuildArtifactIdentity['bundles'];

export class BuildArtifactFailure extends Data.TaggedError('BuildArtifactFailure')<{
  readonly message: string;
}> {}

export function workerBundleDirectory(name: WorkerBundleName, outputRoot = '.output'): string {
  return resolve(outputRoot, 'workers', name);
}

export function workerBundleEntryPoint(name: WorkerBundleName, outputRoot = '.output'): string {
  return join(workerBundleDirectory(name, outputRoot), 'index.js');
}

export function workerDeployArguments(
  entryPoint: string,
  config: string,
  environment: string,
  secretsFile: string,
  dryRun: boolean,
): string[] {
  return [
    'deploy',
    entryPoint,
    '--no-bundle',
    '--config',
    config,
    '--env',
    environment,
    '--secrets-file',
    secretsFile,
    ...(dryRun ? ['--dry-run'] : []),
  ];
}

function directoryDigest(
  directory: string,
  ignoredEntry?: string,
): Effect.Effect<string, BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const digest = createHash('sha256');

    const visit = (path: string): Effect.Effect<void, BuildArtifactFailure> =>
      Effect.gen(function* () {
        const entries = yield* fs
          .readDirectory(path)
          .pipe(Effect.mapError(() => new BuildArtifactFailure({ message: 'Worker build artifact is unreadable' })));

        entries.sort((left, right) => left.localeCompare(right));

        for (const name of entries) {
          const file = join(path, name);
          const relativePath = relative(directory, file).split(sep).join('/');

          if (relativePath === ignoredEntry) continue;

          const entry = yield* Effect.tryPromise({
            try: () => lstat(file),
            catch: () => new BuildArtifactFailure({ message: 'Worker build artifact is unreadable' }),
          });

          if (entry.isDirectory()) {
            yield* visit(file);
          } else if (entry.isFile()) {
            const contents = yield* fs
              .readFile(file)
              .pipe(
                Effect.mapError(() => new BuildArtifactFailure({ message: 'Worker build artifact is unreadable' })),
              );

            yield* Effect.sync(() => {
              digest.update(relativePath);
              digest.update('\0');
              digest.update(contents);
            });
          } else {
            return yield* Effect.fail(
              new BuildArtifactFailure({ message: 'Worker build artifact contains an unsupported file type' }),
            );
          }
        }
      });

    yield* visit(directory);

    return digest.digest('hex');
  });
}

function workerBundleDigest(
  name: WorkerBundleName,
  outputRoot: string,
): Effect.Effect<string, BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entryPoint = workerBundleEntryPoint(name, outputRoot);
    const entry = yield* fs
      .stat(entryPoint)
      .pipe(
        Effect.mapError(
          () => new BuildArtifactFailure({ message: `Worker build artifact is missing its ${name} entrypoint` }),
        ),
      );

    if (entry.type !== 'File') {
      return yield* Effect.fail(
        new BuildArtifactFailure({ message: `Worker build artifact is missing its ${name} entrypoint` }),
      );
    }

    return yield* directoryDigest(workerBundleDirectory(name, outputRoot));
  });
}

function decodeBuildArtifactIdentity(value: unknown): Effect.Effect<BuildArtifactIdentity, BuildArtifactFailure> {
  return Schema.decodeUnknownEffect(BuildArtifactIdentitySchema, {
    errors: 'all',
    onExcessProperty: 'ignore',
  })(value).pipe(Effect.mapError(() => new BuildArtifactFailure({ message: 'Build artifact identity is invalid' })));
}

function readBundleDigests(
  outputRoot: string,
): Effect.Effect<BuildArtifactIdentity['bundles'], BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const [frontend, evidence, briefing] = yield* Effect.all(
      [
        workerBundleDigest('frontend', outputRoot),
        workerBundleDigest('evidence', outputRoot),
        workerBundleDigest('briefing', outputRoot),
      ],
      { concurrency: 'unbounded' },
    );

    return { frontend, evidence, briefing };
  });
}

export function createBuildArtifactIdentity(
  commitSha: string,
  pipelineId: string,
  outputRoot = '.output',
): Effect.Effect<BuildArtifactIdentity, BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    return yield* decodeBuildArtifactIdentity({
      commitSha,
      pipelineId,
      bundles: yield* readBundleDigests(outputRoot),
      artifactSha256: yield* directoryDigest(resolve(outputRoot), 'build-identity.json'),
    });
  });
}

export function writeBuildArtifactIdentity(
  commitSha: string,
  pipelineId: string,
  outputRoot = '.output',
): Effect.Effect<BuildArtifactIdentity, BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const identity = yield* createBuildArtifactIdentity(commitSha, pipelineId, outputRoot);

    yield* fs
      .writeFileString(join(outputRoot, 'build-identity.json'), `${JSON.stringify(identity, null, 2)}\n`, {
        mode: 0o600,
      })
      .pipe(
        Effect.mapError(() => new BuildArtifactFailure({ message: 'Build artifact identity could not be recorded' })),
      );

    return identity;
  });
}

export function verifyBuildArtifactIdentity(
  contents: string,
  outputRoot = '.output',
): Effect.Effect<BuildArtifactIdentity, BuildArtifactFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: (): unknown => JSON.parse(contents),
      catch: () => new BuildArtifactFailure({ message: 'Build artifact identity is unreadable' }),
    });
    const identity = yield* decodeBuildArtifactIdentity(value);
    const actualDigests = yield* readBundleDigests(outputRoot);
    const artifactSha256 = yield* directoryDigest(resolve(outputRoot), 'build-identity.json');

    if (identity.artifactSha256 !== artifactSha256) {
      return yield* Effect.fail(
        new BuildArtifactFailure({ message: 'Build artifact contents do not match the build identity' }),
      );
    }

    if (
      identity.bundles.frontend !== actualDigests.frontend ||
      identity.bundles.evidence !== actualDigests.evidence ||
      identity.bundles.briefing !== actualDigests.briefing
    ) {
      return yield* Effect.fail(
        new BuildArtifactFailure({ message: 'Worker bundle contents do not match the build identity' }),
      );
    }

    return identity;
  });
}
