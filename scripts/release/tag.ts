import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';

import { verifyBuildArtifactIdentity } from '../deploy/buildArtifact.ts';
import {
  assertReleaseTagContext,
  createReleaseTag,
  createReleaseTagApiFromEnvironment,
  loadReleaseTagInput,
} from './tagRelease.ts';
import { ReleaseAutomationFailure } from './version.ts';

function writeTagReceipt(contents: string): Effect.Effect<void, ReleaseAutomationFailure> {
  const path = resolve('.data/production-release/tag.json');

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true }),
      catch: () => new ReleaseAutomationFailure('Release tag receipt could not be written'),
    });
    yield* Effect.tryPromise({
      try: () => writeFile(path, contents, { encoding: 'utf8', mode: 0o600 }),
      catch: () => new ReleaseAutomationFailure('Release tag receipt could not be written'),
    });
  });
}

const program = Effect.gen(function* () {
  yield* assertReleaseTagContext(process.env);
  const input = yield* loadReleaseTagInput(process.env);

  yield* verifyBuildArtifactIdentity(input.buildIdentityContents).pipe(
    Effect.mapError(() => new ReleaseAutomationFailure('Build artifact identity could not be verified')),
  );

  const api = yield* createReleaseTagApiFromEnvironment(process.env);
  const result = yield* createReleaseTag(input, api, writeTagReceipt);

  yield* Effect.try({
    try: () =>
      process.stdout.write(
        `${result.reused ? 'Verified existing' : 'Created'} protected release tag ${result.tag} at ${result.commitSha} ` +
          `(pipeline ${result.pipelineId}).\n`,
      ),
    catch: () => new ReleaseAutomationFailure('Release tagging failed without exposing provider details'),
  });
});

const runnable = program.pipe(Effect.provide(NodeServices.layer));

Effect.runPromise(runnable).catch((cause: unknown) => {
  const message =
    cause instanceof ReleaseAutomationFailure
      ? cause.message
      : 'Release tagging failed without exposing provider details';

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
