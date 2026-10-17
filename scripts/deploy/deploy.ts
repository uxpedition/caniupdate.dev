import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Cause, Effect, Exit, FileSystem, Option, Schema } from 'effect';

import { ReleaseTagReceiptSchema, type ReleaseTagReceipt } from '../../shared/site/releaseIdentity.ts';
import {
  verifyBuildArtifactIdentity,
  workerBundleEntryPoint,
  workerDeployArguments,
  type BuildArtifactIdentity,
  type WorkerBundleName,
} from './buildArtifact.ts';
import { PRIVATE_CI_KEYS, PRODUCTION_ORIGIN, STAGE_ORIGIN } from './configurationKeys.ts';
import {
  assertCurrentMain,
  assertRemoteReleaseTag,
  DeploymentFailure,
  readDeployedVersion,
  runCommand,
} from './deploymentCommands.ts';
import { withRateLimitConfig, type RateLimitBinding } from './rateLimitConfig.ts';
import {
  readRuntimeSettings,
  RuntimeSettingsFailure,
  type DeploymentTarget,
  type WorkerSecrets,
} from './runtimeSettings.ts';
import { withWorkerSecrets } from './workerSecrets.ts';

type Step = { name: string; status: 'started' | 'passed' | 'failed'; versionId?: string };

const targetArgument = process.argv.find((argument) => argument.startsWith('--target='));
const targetValue = targetArgument?.slice('--target='.length);
const target: DeploymentTarget = targetValue === 'production' ? 'production' : 'stage';
const wranglerEnvironment = target;
const workers =
  target === 'stage'
    ? {
        evidence: 'can-i-update-preview-evidence',
        briefing: 'can-i-update-preview-briefing',
        frontend: 'can-i-update-preview',
        origin: STAGE_ORIGIN,
      }
    : {
        evidence: 'can-i-update-production-evidence',
        briefing: 'can-i-update-production-briefing',
        frontend: 'can-i-update-production',
        origin: PRODUCTION_ORIGIN,
      };
const reportDirectory = target === 'stage' ? '.data/stage-deployment' : '.data/production-deployment';
const dryRun = process.argv.includes('--dry-run');

function digestDirectory(directory: string): Effect.Effect<string, DeploymentFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const digest = createHash('sha256');

    const visit = (path: string): Effect.Effect<void, DeploymentFailure> =>
      Effect.gen(function* () {
        const entries = yield* fs
          .readDirectory(path)
          .pipe(
            Effect.mapError(
              () => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' }),
            ),
          );

        entries.sort((left, right) => left.localeCompare(right));

        for (const name of entries) {
          const file = join(path, name);
          const entry = yield* Effect.tryPromise({
            try: () => lstat(file),
            catch: () => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' }),
          });

          if (entry.isDirectory()) {
            yield* visit(file);
          } else if (entry.isFile()) {
            const contents = yield* fs
              .readFile(file)
              .pipe(
                Effect.mapError(
                  () => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' }),
                ),
              );

            yield* Effect.sync(() => {
              digest.update(file);
              digest.update('\0');
              digest.update(contents);
            });
          } else {
            return yield* Effect.fail(
              new DeploymentFailure({ message: 'Build artifact contains an unsupported entry' }),
            );
          }
        }
      });

    yield* visit(directory);

    return digest.digest('hex');
  });
}

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
  target: DeploymentTarget,
  rateLimit?: { binding: RateLimitBinding; limit: number },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const step: Step = { name, status: 'started' };
    const outputFile = join(reportDirectory, `${name}.ndjson`);

    currentStep = step;
    steps.push(step);
    yield* assertCurrentMain(commitSha, target);
    yield* fs
      .writeFileString(outputFile, '', { mode: 0o600 })
      .pipe(
        Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
      );

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
      yield* withRateLimitConfig(config, target, rateLimit.binding, rateLimit.limit, deploy);
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
let releaseReceipt: ReleaseTagReceipt | undefined;

function matchesProtectedPipelineArtifact(build: BuildArtifactIdentity): boolean {
  return (
    process.env['CI_PIPELINE_SOURCE'] === 'parent_pipeline' &&
    process.env['CI_COMMIT_BRANCH'] === 'main' &&
    process.env['CI_COMMIT_REF_PROTECTED'] === 'true' &&
    process.env['CI_ENVIRONMENT_NAME'] === target &&
    build.commitSha === process.env['CI_COMMIT_SHA'] &&
    build.pipelineId === process.env['PARENT_PIPELINE_ID']
  );
}

function readBuildArtifact() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (targetValue !== 'stage' && targetValue !== 'production') {
      return yield* Effect.fail(new DeploymentFailure({ message: 'Deployment target must be stage or production' }));
    }

    const identityContents = yield* fs
      .readFileString('.output/build-identity.json', 'utf8')
      .pipe(
        Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
      );
    const build = yield* verifyBuildArtifactIdentity(identityContents);

    if (!matchesProtectedPipelineArtifact(build)) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: `${target} requires its own protected main pipeline artifact` }),
      );
    }

    if (!dryRun && !process.env['CLOUDFLARE_API_TOKEN']) {
      return yield* Effect.fail(new DeploymentFailure({ message: `${target} credentials are missing` }));
    }

    return build;
  });
}

function readProductionReceipt(build: BuildArtifactIdentity) {
  if (target !== 'production') return Effect.succeed(undefined);

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const receiptContents = yield* fs
      .readFileString('.data/production-release/tag.json', 'utf8')
      .pipe(
        Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
      );
    const receipt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseTagReceiptSchema), {
      errors: 'all',
      onExcessProperty: 'ignore',
    })(receiptContents).pipe(
      Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
    );

    if (receipt.tag !== `v${receipt.version}`) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' }),
      );
    }

    if (receipt.commitSha !== build.commitSha || receipt.pipelineId !== build.pipelineId) {
      return yield* Effect.fail(
        new DeploymentFailure({ message: 'Protected release tag receipt does not match the production artifact' }),
      );
    }

    releaseReceipt = receipt;
    yield* assertRemoteReleaseTag(receipt.tag, receipt.commitSha);

    return receipt;
  });
}

function loadRuntimeSettings(releaseVersion?: string) {
  return Effect.gen(function* () {
    const settings = yield* readRuntimeSettings(process.env, target, releaseVersion);
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

    artifactDigest = yield* digestDirectory('.output');
    migrationFiles = (yield* fs
      .readDirectory('migrations')
      .pipe(
        Effect.mapError(() => new DeploymentFailure({ message: 'Invalid artifact or unreadable deployment receipt' })),
      ))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    yield* assertCurrentMain(build.commitSha, target);
  });
}

function applyRemoteMigrations(buildCommitSha: string, workerEnvironment: NodeJS.ProcessEnv) {
  return Effect.gen(function* () {
    const step: Step = { name: 'd1-migrations', status: 'started' };

    currentStep = step;
    steps.push(step);
    yield* assertCurrentMain(buildCommitSha, target);
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
  releaseReceipt = yield* readProductionReceipt(build);
  const { settings, workerEnvironment } = yield* loadRuntimeSettings(releaseReceipt?.version);

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
    target,
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
    target,
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
    target,
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
        : 'Invalid artifact or unreadable deployment receipt';

    if (currentStep) currentStep.status = 'failed';

    yield* Effect.sync(() => {
      process.stderr.write(
        `${target} ${currentStep?.name ?? 'setup'} failed; no automatic rollback. See sanitized deployment report.\n`,
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
          target,
          dryRun,
          artifactDigest,
          release: releaseReceipt,
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
