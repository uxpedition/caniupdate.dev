import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Log, LogLevel, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const CONFIG_PATH = join(ROOT, 'workers', 'evidence', 'test', 'tarball.wrangler.jsonc');

const WRANGLER_BIN = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const WORKER_NAME = 'can-i-update-tarball-streaming-test';

type WorkerResponse = {
  status: number;
  json(): Promise<unknown>;
};

type WorkerHandle = { fetch(input: string): Promise<WorkerResponse> };

let runtime: Miniflare | undefined;

let worker: WorkerHandle | undefined;

async function bundleFixture(): Promise<Record<string, { type: 'esm'; contents: string }>> {
  const outdir = await mkdtemp(join(tmpdir(), 'tarball-workerd-bundle-'));

  try {
    await execFileAsync(
      process.execPath,
      [WRANGLER_BIN, 'deploy', '--dry-run', '--config', CONFIG_PATH, '--env=', '--outdir', outdir],
      { cwd: ROOT },
    );
    const modules: Record<string, { type: 'esm'; contents: string }> = {};

    for (const entry of await readdir(outdir)) {
      if (entry.endsWith('.js'))
        modules[entry] = { type: 'esm', contents: await readFile(join(outdir, entry), 'utf8') };
    }

    return modules;
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

async function inspect(mode: string): Promise<{ response: WorkerResponse; body: unknown }> {
  if (worker === undefined) throw new Error('Workerd fixture has not started');
  const response = await worker.fetch(`https://tarball.test/${mode}`);

  return { response, body: await response.json() };
}

describe('tarball stream lifecycle in workerd', () => {
  beforeAll(async () => {
    const modules = await bundleFixture();
    runtime = new Miniflare({
      log: new Log(LogLevel.ERROR),
      workers: [
        {
          config: {
            name: WORKER_NAME,
            compatibilityDate: '2026-09-16',
            compatibilityFlags: ['nodejs_compat'],
            manifest: { mainModule: 'tarball.worker.js', modules },
          },
        },
      ],
    });
    worker = await runtime.getWorker(WORKER_NAME);
  }, 120_000);

  afterAll(async () => {
    await runtime?.dispose();
  });

  it('completes a valid tar archive', async () => {
    const { response, body } = await inspect('valid');
    expect(response.status).toBe(200);
    expect(body).toEqual({ available: true, entries: 0 });
  });

  it('rejects malformed tar data', async () => {
    const { response, body } = await inspect('malformed');
    expect(response.status).toBe(422);
    expect(body).toEqual({ available: false });
  });

  it('rejects invalid gzip data', async () => {
    const { response, body } = await inspect('invalid-gzip');
    expect(response.status).toBe(422);
    expect(body).toEqual({ available: false });
  });

  it('rejects decompressed data beyond the archive limit', async () => {
    const { response, body } = await inspect('oversized');
    expect(response.status).toBe(422);
    expect(body).toEqual({ available: false });
  }, 60_000);
});
