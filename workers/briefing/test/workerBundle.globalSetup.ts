// Vitest global setup for the briefing Worker bundle: one Wrangler dry-run per test run, into a fresh OS temp directory,
// whose path the workers receive through `provide`. Vitest runs setup before any worker starts and only when at least
// one test is queued; watch reruns rebuild before their tests run. Build failure rejects setup, which fails the run.

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { TestProject } from 'vitest/node';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/** Builds the Worker exactly as the deploy path does and returns the directory holding its modules. */
async function buildWorkerBundle(): Promise<string> {
  const outdir = await mkdtemp(join(tmpdir(), 'briefing-bundle-'));

  try {
    await execFileAsync(
      process.execPath,
      [
        WRANGLER_BIN,
        'deploy',
        '--dry-run',
        '--config',
        join('workers', 'briefing', 'wrangler.jsonc'),
        '--env=',
        '--outdir',
        outdir,
      ],
      { cwd: REPO_ROOT },
    );

    // A dry run that exits cleanly without emitting any JavaScript must not provide an empty bundle.
    if (!(await readdir(outdir)).some((entry) => entry.endsWith('.js')))
      throw new Error(`Wrangler dry-run emitted no .js modules into ${outdir}`);

    return outdir;
  } catch (error) {
    await rm(outdir, { recursive: true, force: true });
    throw error;
  }
}

export default async function setup(project: TestProject) {
  // Every build stays until teardown: a watch rerun may still be waiting on workers from the previous run.
  const builds: string[] = [];

  const provideFresh = async () => {
    const outdir = await buildWorkerBundle();
    builds.push(outdir);
    project.provide('briefingWorkerBundleDir', outdir);
  };

  await provideFresh();
  project.onTestsRerun(provideFresh);

  return async () => {
    await Promise.all(builds.map((outdir) => rm(outdir, { recursive: true, force: true })));
  };
}
