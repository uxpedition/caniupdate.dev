import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  createBuildArtifactIdentity,
  verifyBuildArtifactIdentity,
  workerBundleEntryPoint,
  workerDeployArguments,
} from './buildArtifact.ts';

const COMMIT_SHA = 'a'.repeat(40);
const PIPELINE_ID = '4711';
const runWithNodeServices = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));

async function writeBundles(root: string): Promise<void> {
  for (const name of ['frontend', 'evidence', 'briefing']) {
    const directory = join(root, 'workers', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.js'), `export const worker = '${name}';\n`);
  }
}

describe('verified Worker build artifacts', () => {
  it('records and checks the built frontend and backend bundle contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'can-i-update-build-artifact-'));

    try {
      await writeBundles(root);
      const identity = await runWithNodeServices(createBuildArtifactIdentity(COMMIT_SHA, PIPELINE_ID, root));

      await expect(runWithNodeServices(verifyBuildArtifactIdentity(JSON.stringify(identity), root))).resolves.toEqual(
        identity,
      );

      await writeFile(join(root, 'workers', 'briefing', 'index.js'), 'export const worker = "changed";\n');
      await expect(runWithNodeServices(verifyBuildArtifactIdentity(JSON.stringify(identity), root))).rejects.toThrow(
        'do not match the build identity',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deploys the exact prebuilt entrypoint without asking Wrangler to bundle it again', () => {
    expect(workerBundleEntryPoint('frontend')).toBe(resolve('.output/workers/frontend/index.js'));
    expect(
      workerDeployArguments(
        workerBundleEntryPoint('evidence'),
        'workers/evidence/wrangler.jsonc',
        'stage',
        '/tmp/secrets.json',
        false,
      ),
    ).toEqual([
      'deploy',
      resolve('.output/workers/evidence/index.js'),
      '--no-bundle',
      '--config',
      'workers/evidence/wrangler.jsonc',
      '--env',
      'stage',
      '--secrets-file',
      '/tmp/secrets.json',
    ]);
  });
});
