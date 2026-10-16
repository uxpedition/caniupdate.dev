// The briefing Worker bundle every Miniflare suite runs. `workerBundle.globalSetup.ts` builds it once per test run with
// the repo's own Wrangler and provides only its directory; this module reads the modules back inside each worker, so
// no suite ever sees an earlier run's build.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { inject } from 'vitest';

/** The provided key. Its value is the absolute directory holding the built `.js` modules. */
const WORKER_BUNDLE_DIR = 'briefingWorkerBundleDir';

declare module 'vitest' {
  export interface ProvidedContext {
    briefingWorkerBundleDir: string;
  }
}

export type WorkerBundle = Record<string, { type: 'esm'; contents: string }>;

let preparedBundle: { dir: string; modules: Promise<WorkerBundle> } | undefined;

async function readWorkerModules(dir: string): Promise<WorkerBundle> {
  const modules: WorkerBundle = {};

  for (const entry of await readdir(dir)) {
    if (entry.endsWith('.js')) modules[entry] = { type: 'esm', contents: await readFile(join(dir, entry), 'utf8') };
  }

  return modules;
}

export async function loadWorkerBundle(): Promise<WorkerBundle> {
  const dir = inject(WORKER_BUNDLE_DIR);

  if (dir === undefined)
    throw new Error(`${WORKER_BUNDLE_DIR} not provided; register workerBundle.globalSetup.ts in vitest.config.ts`);

  if (preparedBundle?.dir !== dir) preparedBundle = { dir, modules: readWorkerModules(dir) };

  return await preparedBundle.modules;
}
