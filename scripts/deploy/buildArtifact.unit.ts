import { createHash } from 'node:crypto';
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
  it('hashes sorted relative paths before contents and excludes the identity file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'can-i-update-build-artifact-'));

    try {
      await writeBundles(root);
      await mkdir(join(root, 'workers', 'frontend', 'a'));
      await writeFile(join(root, 'workers', 'frontend', 'a', 'z.js'), 'nested');
      await writeFile(join(root, 'build-identity.json'), 'ignored identity');

      const identity = await runWithNodeServices(createBuildArtifactIdentity(COMMIT_SHA, PIPELINE_ID, root));

      const expected = createHash('sha256')
        .update('a/z.js\0')
        .update('nested')
        .update('index.js\0')
        .update("export const worker = 'frontend';\n")
        .digest('hex');

      expect(identity.bundles.frontend).toBe(expected);
      await writeFile(join(root, 'build-identity.json'), 'changed ignored identity');
      expect(await runWithNodeServices(createBuildArtifactIdentity(COMMIT_SHA, PIPELINE_ID, root))).toEqual(identity);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['{', 'Build artifact identity is unreadable'],
    ['null', 'Build artifact identity is invalid'],
    ['1e400', 'Build artifact identity is invalid'],
    ['{}', 'Build artifact identity is invalid'],
  ])('classifies invalid identity %s before reading bundle files', async (contents, message) => {
    await expect(runWithNodeServices(verifyBuildArtifactIdentity(contents, '/unused-fixture-path'))).rejects.toThrow(
      message,
    );
  });

  it('records and checks the built frontend and backend bundle contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'can-i-update-build-artifact-'));

    try {
      await writeBundles(root);
      const identity = await runWithNodeServices(createBuildArtifactIdentity(COMMIT_SHA, PIPELINE_ID, root));

      await expect(runWithNodeServices(verifyBuildArtifactIdentity(JSON.stringify(identity), root))).resolves.toEqual(
        identity,
      );

      const withIgnoredOverflow = `${JSON.stringify(identity).slice(0, -1)},"ignored":1e400}`;

      await expect(runWithNodeServices(verifyBuildArtifactIdentity(withIgnoredOverflow, root))).resolves.toEqual(
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
