import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Exit } from 'effect';

import { BuildArtifactFailure, writeBuildArtifactIdentity } from './buildArtifact.ts';

const program = Effect.gen(function* () {
  const commitSha = process.env['CI_COMMIT_SHA'];
  const pipelineId = process.env['CI_PIPELINE_ID'];

  if (commitSha === undefined || pipelineId === undefined) {
    return yield* Effect.fail(
      new BuildArtifactFailure({ message: 'Build identity requires CI commit and pipeline identity' }),
    );
  }

  yield* writeBuildArtifactIdentity(commitSha, pipelineId);
}).pipe(Effect.provide(NodeServices.layer));

const cli = Effect.gen(function* () {
  const result = yield* Effect.exit(program);

  if (Exit.isFailure(result)) {
    yield* Effect.sync(() => {
      process.stderr.write('Build artifact identity could not be recorded for this protected pipeline.\n');
      process.exitCode = 1;
    });
  }
});

NodeRuntime.runMain(cli);
