import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readDeployedVersion } from './deploymentCommands.ts';

async function readFixtureReceipt(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'can-i-update-receipt-'));

  try {
    const path = join(directory, 'deployment.ndjson');

    await writeFile(path, contents, { mode: 0o600 });

    return await Effect.runPromise(
      readDeployedVersion(path, 'fixture-worker').pipe(Effect.provide(NodeServices.layer)),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const deployment = (worker: string, version: string) =>
  JSON.stringify({ type: 'deploy', worker_name: worker, version_id: version });

describe('deployment receipt decoding', () => {
  it('ignores nondeployment JSON and retains the last matching deployed version', async () => {
    const records = [
      'null',
      '[]',
      '42',
      '{"type":"build","worker_name":"other"}',
      '{"type":"build","size":1e400}',
      '{"type":"deploy","worker_name":"fixture-worker","version_id":42}',
      deployment('fixture-worker', 'first'),
      deployment('fixture-worker', 'last'),
    ];

    await expect(readFixtureReceipt(` ${records.join('\n')}\n`)).resolves.toBe('last');
  });

  it.each([
    ['{', 'Invalid artifact or unreadable deployment receipt'],
    ['', 'Invalid artifact or unreadable deployment receipt'],
    ['null', 'Deployed Worker version was not recorded'],
    [deployment('fixture-worker', ''), 'Deployed Worker version was not recorded'],
    [deployment('unexpected-worker', 'version'), 'Deployment output names an unexpected Worker'],
    [`${deployment('fixture-worker', 'version')}\n{`, 'Invalid artifact or unreadable deployment receipt'],
  ])('preserves failure classification for receipt %s', async (contents, message) => {
    await expect(readFixtureReceipt(contents)).rejects.toThrow(message);
  });
});
