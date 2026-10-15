import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkerSecrets } from './runtimeSettings.ts';

export async function withWorkerSecrets<Result>(
  secrets: WorkerSecrets,
  deploy: (path: string) => Promise<Result>,
): Promise<Result> {
  // mkdtemp creates an owner-only directory outside checkout/artifact paths. Never dump this file or its values.
  const directory = await mkdtemp(join(tmpdir(), 'can-i-update-worker-secrets-'));
  const path = join(directory, 'secrets.json');

  try {
    await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });

    return await deploy(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
