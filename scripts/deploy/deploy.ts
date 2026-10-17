import { join } from 'node:path';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Cause, Effect, Exit, FileSystem, Option } from 'effect';

import {
  verifyBuildArtifactIdentity,
  workerBundleEntryPoint,
  workerDeployArguments,
  type BuildArtifactIdentity,
  type WorkerBundleName,
} from './buildArtifact.ts';
import { PRIVATE_CI_KEYS, STAGE_ORIGIN } from './configurationKeys.ts';
import { assertCurrentMain, DeploymentFailure, readDeployedVersion, runCommand } from './deploymentCommands.ts';
import { withRateLimitConfig, type RateLimitBinding } from './rateLimitConfig.ts';
import { readRuntimeSettings, RuntimeSettingsFailure, type WorkerSecrets } from './runtimeSettings.ts';
import { withWorkerSecrets } from './workerSecrets.ts';

type Step = { name: string; status: 'started' | 'passed' | 'failed'; versionId?: string };

const targetArgument = process.argv.find((argument) => argument.startsWith('--target='));
const targetValue = targetArgument?.slice('--target='.length);
const wranglerEnvironment = 'stage';
const workers = {
  evidence: 'can-i-update-preview-evidence',
  briefing: 'can-i-update-preview-briefing',
  frontend: 'can-i-update-preview',
};
const reportDirectory = '.data/stage-deployment';
const dryRun = process.argv.includes('--dry-run');

function deployWorker(
  name: string,
  bundleName: WorkerBundleName,
  config: string,
  secrets: WorkerSecrets,
  environment: NodeJS.ProcessEnv,
  commitSha: string,
  reportDirectory: string,
  wranglerEnvironment: string,
  dryRun: boolean,
  rateLimit?: { binding: RateLimitBinding; limit: number },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const step: Step = { name, status: 'started' };
    const outputFile = join(reportDirectory, `${name}.ndjson`);

    currentStep = step;
    steps.push(step);
    yield* assertCurrentMain(commitSha);
    yield* fs
      .writeFileString(outputFile, '', { mode: 0o600 })
      .pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Deployment report could not be written' })));

    const deploy = (deploymentConfig: string) =>
      withWorkerSecrets(secrets, (secretFile) =>
        runCommand(
          'nub',
          [
            'exec',
            'wrangler',
            ...workerDeployArguments(
              workerBundleEntryPoint(bundleName),
              deploymentConfig,
              wranglerEnvironment,
              secretFile,
              dryRun,
            ),
          ],
          { ...environment, WRANGLER_OUTPUT_FILE_PATH: outputFile },
        ),
      );

    if (rateLimit === undefined) {
      yield* deploy(config);
    } else {
      yield* withRateLimitConfig(config, rateLimit.binding, rateLimit.limit, deploy);
    }

    if (!dryRun) step.versionId = yield* readDeployedVersion(outputFile, name);

    step.status = 'passed';
  });
}

const steps: Step[] = [];
let currentStep: Step | undefined;
let artifactDigest: string | undefined;
let migrationFiles: string[] = [];
let failureReason: string | undefined;

function matchesProtectedPipelineArtifact(build: BuildArtifactIdentity): boolean {
  return (
    process.env['CI_PIPELINE_SOURCE'] === 'parent_pipeline' &&
    process.env['CI_COMMIT_BRANCH'] === 'main' &&
    process.env['CI_COMMIT_REF_PROTECTED'] === 'true' &&
    process.env['CI_ENVIRONMENT_NAME'] === 'stage' &&
    build.commitSha === process.env['CI_COMMIT_SHA'] &&
    build.pipelineId === process.env['PARENT_PIPELINE_ID']
  );
}

function readBuildArtifact() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (targetValue !== 'stage') {
      return yield* Effect.fail(new DeploymentFailure({ message: 'Deployment target must be stage' }));
    }

    const identityContents = yield* fs
      .readFileString('.output/build-identity.json', 'utf8')
      .pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Build artifact identity is unavailable' })));
    const build = yield* verifyBuildArtifactIdentity(identityContents);

    if (!matchesProtectedPipelineArtifact(build)) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: 'stage requires its own protected main pipeline artifact' }),
      );
    }

    if (!dryRun && !process.env['CLOUDFLARE_API_TOKEN']) {
      return yield* Effect.fail(new DeploymentFailure({ message: 'stage credentials are missing' }));
    }

    return build;
  });
}

function loadRuntimeSettings() {
  return Effect.gen(function* () {
    const settings = yield* readRuntimeSettings(process.env);
    const workerEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    };

    for (const key of PRIVATE_CI_KEYS) {
      if (key !== 'CLOUDFLARE_API_TOKEN') delete workerEnvironment[key];
    }

    return { settings, workerEnvironment };
  });
}

function collectArtifactEvidence(build: BuildArtifactIdentity) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    artifactDigest = build.artifactSha256;
    migrationFiles = (yield* fs
      .readDirectory('migrations')
      .pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Build migration evidence is unavailable' }))))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    yield* assertCurrentMain(build.commitSha);
  });
}

function applyRemoteMigrations(buildCommitSha: string, workerEnvironment: NodeJS.ProcessEnv) {
  return Effect.gen(function* () {
    const step: Step = { name: 'd1-migrations', status: 'started' };

    currentStep = step;
    steps.push(step);
    yield* assertCurrentMain(buildCommitSha);
    yield* runCommand(
      'nub',
      [
        'exec',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'BRIEFINGS_DB',
        '--remote',
        '--config',
        'workers/briefing/wrangler.jsonc',
        '--env',
        wranglerEnvironment,
      ],
      workerEnvironment,
    );
    step.status = 'passed';
  });
}

const deployment = Effect.gen(function* () {
  const preflightStep: Step = { name: 'preflight', status: 'started' };

  currentStep = preflightStep;
  steps.push(preflightStep);

  const build = yield* readBuildArtifact();
  const { settings, workerEnvironment } = yield* loadRuntimeSettings();

  yield* collectArtifactEvidence(build);
  preflightStep.status = 'passed';

  if (!dryRun) yield* applyRemoteMigrations(build.commitSha, workerEnvironment);

  yield* deployWorker(
    workers.evidence,
    'evidence',
    'workers/evidence/wrangler.jsonc',
    settings.evidence,
    workerEnvironment,
    build.commitSha,
    reportDirectory,
    wranglerEnvironment,
    dryRun,
  );
  yield* deployWorker(
    workers.briefing,
    'briefing',
    'workers/briefing/wrangler.jsonc',
    settings.briefing,
    workerEnvironment,
    build.commitSha,
    reportDirectory,
    wranglerEnvironment,
    dryRun,
    { binding: 'BRIEFING_GENERATION_LIMITER', limit: settings.rateLimits.generation },
  );
  yield* deployWorker(
    workers.frontend,
    'frontend',
    '.output/server/wrangler.json',
    settings.frontend,
    workerEnvironment,
    build.commitSha,
    reportDirectory,
    wranglerEnvironment,
    dryRun,
    { binding: 'PUBLIC_RATE_LIMITER', limit: settings.rateLimits.public },
  );
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .makeDirectory(reportDirectory, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Deployment report could not be written' })));

  const result = yield* Effect.exit(deployment);

  if (Exit.isFailure(result)) {
    const error = Option.getOrElse(Cause.findErrorOption(result.cause), () => undefined);

    failureReason =
      error instanceof DeploymentFailure || error instanceof RuntimeSettingsFailure
        ? error.message
        : 'Stage deployment failed';

    if (currentStep) currentStep.status = 'failed';

    yield* Effect.sync(() => {
      process.stderr.write(
        `stage ${currentStep?.name ?? 'setup'} failed; no automatic rollback. See sanitized deployment report.\n`,
      );
      process.exitCode = 1;
    });
  }

  yield* fs
    .writeFileString(
      join(reportDirectory, 'report.json'),
      JSON.stringify(
        {
          commitSha: process.env['CI_COMMIT_SHA'],
          pipelineId: process.env['CI_PIPELINE_ID'],
          parentPipelineId: process.env['PARENT_PIPELINE_ID'],
          target: 'stage',
          origin: STAGE_ORIGIN,
          dryRun,
          artifactDigest,
          migrationFiles,
          recordedAt: new Date().toISOString(),
          status: Exit.isFailure(result) ? 'failed' : 'passed',
          failureReason,
          steps,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    )
    .pipe(Effect.mapError(() => new DeploymentFailure({ message: 'Deployment report could not be written' })));
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
