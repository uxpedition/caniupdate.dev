import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Schema } from 'effect';

import { PRIVATE_CI_KEYS, STAGE_ORIGIN } from './configurationKeys.ts';
import { readRuntimeSettings, RuntimeSettingsFailure } from './runtimeSettings.ts';
import type { WorkerSecrets } from './runtimeSettings.ts';
import { withWorkerSecrets } from './workerSecrets.ts';

const BuildSchema = Schema.Struct({
  commitSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  origin: Schema.Literal(STAGE_ORIGIN),
  pipelineId: Schema.String,
});

const DeploymentSchema = Schema.Struct({
  type: Schema.Literal('deploy'),
  worker_name: Schema.String,
  version_id: Schema.String,
});

class PreviewFailure extends Error {}

type Step = { name: string; status: 'started' | 'passed' | 'failed'; versionId?: string };

const reportDirectory = '.data/preview-deployment';

const steps: Step[] = [];

const dryRun = process.argv.includes('--dry-run');

let currentStep: Step | undefined;

let artifactDigest: string | undefined;

let migrationFiles: string[] = [];

let failureReason: string | undefined;

async function digestDirectory(path: string): Promise<string> {
  const digest = createHash('sha256');

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const file = join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile()) {
        digest.update(file);
        digest.update('\0');
        digest.update(await readFile(file));
      } else {
        throw new PreviewFailure('Build artifact contains an unsupported entry');
      }
    }
  }

  await visit(path);

  return digest.digest('hex');
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment });

  if (result.error || result.status !== 0) {
    throw new PreviewFailure('Deployment command failed');
  }
}

function assertCurrentMain(commitSha: string): void {
  // Run inside the resource-group lock immediately before the first mutation. A superseded pipeline must not
  // migrate or deploy, even if it was retried or spent longer validating than a newer revision.
  const result = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0 || result.stdout.trim() !== `${commitSha}\trefs/heads/main`) {
    throw new PreviewFailure('Stage revision is superseded or main cannot be verified');
  }
}

async function readDeployedVersion(outputFile: string, expectedWorker: string): Promise<string> {
  const records = (await readFile(outputFile, 'utf8')).trim().split('\n');
  const isDeployment = Schema.is(DeploymentSchema);

  let versionId: string | undefined;

  for (const line of records) {
    const record: unknown = JSON.parse(line);

    if (!isDeployment(record)) continue;

    if (record.worker_name !== expectedWorker) throw new PreviewFailure('Unexpected deployed Worker identity');

    versionId = record.version_id;
  }

  if (!versionId) throw new PreviewFailure('Deployed Worker version was not recorded');

  return versionId;
}

async function deployWorker(
  name: string,
  config: string,
  secrets: WorkerSecrets,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  currentStep = { name, status: 'started' };
  steps.push(currentStep);

  const outputFile = join(reportDirectory, `${name}.ndjson`);

  await writeFile(outputFile, '', { mode: 0o600 });
  await withWorkerSecrets(secrets, async (secretFile) => {
    run(
      'nub',
      [
        'exec',
        'wrangler',
        'deploy',
        '--config',
        config,
        '--env',
        'preview',
        '--secrets-file',
        secretFile,
        ...(dryRun ? ['--dry-run'] : []),
      ],
      { ...environment, WRANGLER_OUTPUT_FILE_PATH: outputFile },
    );
  });

  if (!dryRun) currentStep.versionId = await readDeployedVersion(outputFile, name);

  currentStep.status = 'passed';
}

try {
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });

  currentStep = { name: 'preflight', status: 'started' };
  steps.push(currentStep);

  const build = Schema.decodeUnknownSync(BuildSchema)(JSON.parse(await readFile('.output/preview-build.json', 'utf8')));

  if (
    process.env['CI_PIPELINE_SOURCE'] !== 'push' ||
    process.env['CI_COMMIT_BRANCH'] !== 'main' ||
    process.env['CI_COMMIT_REF_PROTECTED'] !== 'true' ||
    process.env['CI_ENVIRONMENT_NAME'] !== 'stage' ||
    build.commitSha !== process.env['CI_COMMIT_SHA'] ||
    build.pipelineId !== process.env['CI_PIPELINE_ID']
  ) {
    throw new PreviewFailure('Stage requires its own protected main pipeline artifact');
  }

  if (
    !dryRun &&
    ['CLOUDFLARE_API_TOKEN', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'].some((key) => !process.env[key])
  ) {
    throw new PreviewFailure('Stage credentials are missing');
  }

  const settings = readRuntimeSettings(process.env);

  const workerEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  };

  const smokeEnvironment: NodeJS.ProcessEnv = { ...workerEnvironment };

  for (const key of PRIVATE_CI_KEYS) {
    if (key !== 'CLOUDFLARE_API_TOKEN') delete workerEnvironment[key];

    if (key !== 'CF_ACCESS_CLIENT_ID' && key !== 'CF_ACCESS_CLIENT_SECRET') delete smokeEnvironment[key];
  }

  artifactDigest = await digestDirectory('.output');
  migrationFiles = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
  assertCurrentMain(build.commitSha);
  currentStep.status = 'passed';

  if (!dryRun) {
    currentStep = { name: 'd1-migrations', status: 'started' };
    steps.push(currentStep);
    run(
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
        'preview',
      ],
      workerEnvironment,
    );
    currentStep.status = 'passed';
  }

  await deployWorker(
    'can-i-update-preview-evidence',
    'workers/evidence/wrangler.jsonc',
    settings.evidence,
    workerEnvironment,
  );
  await deployWorker(
    'can-i-update-preview-briefing',
    'workers/briefing/wrangler.jsonc',
    settings.briefing,
    workerEnvironment,
  );
  await deployWorker('can-i-update-preview', '.output/server/wrangler.json', settings.frontend, workerEnvironment);

  if (!dryRun) {
    currentStep = { name: 'deployed-verification', status: 'started' };
    steps.push(currentStep);
    run('nub', ['run', 'smoke:deployed'], smokeEnvironment);
    currentStep.status = 'passed';
  }
} catch (cause) {
  failureReason =
    cause instanceof PreviewFailure || cause instanceof RuntimeSettingsFailure
      ? cause.message
      : 'Invalid artifact or unreadable deployment receipt';

  if (currentStep) {
    currentStep.status = 'failed';
  }

  process.stderr.write(
    `Stage ${currentStep?.name ?? 'setup'} failed; no automatic rollback. See sanitized deployment report.\n`,
  );
  process.exitCode = 1;
} finally {
  await writeFile(
    join(reportDirectory, 'report.json'),
    JSON.stringify(
      {
        commitSha: process.env['CI_COMMIT_SHA'],
        pipelineId: process.env['CI_PIPELINE_ID'],
        origin: STAGE_ORIGIN,
        dryRun,
        artifactDigest,
        migrationFiles,
        recordedAt: new Date().toISOString(),
        status: process.exitCode ? 'failed' : 'passed',
        failureReason,
        steps,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
