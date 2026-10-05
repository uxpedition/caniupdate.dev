import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { SqlStorageValue } from '@cloudflare/workers-types';
import { Schema } from 'effect';
import { Log, LogLevel, Miniflare } from 'miniflare';

import type { CacheFixtureCommand } from './cache.worker';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG_PATH = join(ROOT, 'workers', 'evidence', 'test', 'cache.wrangler.jsonc');
const WRANGLER_BIN = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const WORKER_NAME = 'can-i-update-evidence-cache-test';
const BINDING_NAME = 'EVIDENCE_CACHE';
const CLASS_NAME = 'EvidenceCacheFixture';
const InitializedResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ initialized: Schema.Literal(true) }),
  loaderCalls: Schema.Finite,
});
const isInitializedResponse = Schema.is(InitializedResponseSchema);

type WorkerModules = Record<string, { type: 'esm'; contents: string }>;

export type EvidenceCacheFixture = {
  call(command: CacheFixtureCommand): Promise<unknown>;
  exec(sql: string, ...bindings: SqlStorageValue[]): Promise<readonly Record<string, SqlStorageValue>[]>;
  restart(): Promise<void>;
  dispose(): Promise<void>;
};

export type EvidenceCacheFixtureOptions = { initialize?: boolean };

let workerBundle: Promise<WorkerModules> | undefined;

async function bundleFixture(): Promise<WorkerModules> {
  const outdir = await mkdtemp(join(tmpdir(), 'evidence-cache-workerd-bundle-'));
  try {
    await execFileAsync(
      process.execPath,
      [WRANGLER_BIN, 'deploy', '--dry-run', '--config', CONFIG_PATH, '--env=', '--outdir', outdir],
      { cwd: ROOT },
    );
    const modules: WorkerModules = {};
    for (const entry of await readdir(outdir)) {
      if (entry.endsWith('.js'))
        modules[entry] = { type: 'esm', contents: await readFile(join(outdir, entry), 'utf8') };
    }
    return modules;
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

function createRuntime(stateDir: string, modules: WorkerModules): Miniflare {
  return new Miniflare({
    log: new Log(LogLevel.ERROR),
    resourcePersistencePath: stateDir,
    unsafeInspectDurableObjects: true,
    workers: [
      {
        config: {
          name: WORKER_NAME,
          compatibilityDate: '2026-09-16',
          compatibilityFlags: ['nodejs_compat'],
          env: {
            [BINDING_NAME]: { type: 'durable-object', worker: WORKER_NAME, exportName: CLASS_NAME },
          },
          exports: { [CLASS_NAME]: { type: 'durable-object', storage: 'sqlite' } },
          manifest: { mainModule: 'cache.worker.js', modules },
        },
      },
    ],
  });
}

export async function openEvidenceCacheFixture(
  options: EvidenceCacheFixtureOptions = {},
): Promise<EvidenceCacheFixture> {
  workerBundle ??= bundleFixture();
  const modules = await workerBundle;
  const stateDir = await mkdtemp(join(tmpdir(), 'evidence-cache-workerd-state-'));
  const objectName = `evidence-cache-${randomUUID()}`;
  let runtime: Miniflare | undefined;

  try {
    let activeRuntime = createRuntime(stateDir, modules);
    runtime = activeRuntime;
    let namespace = await activeRuntime.getDurableObjectNamespace(BINDING_NAME, WORKER_NAME);
    let adminStorage = await activeRuntime.unsafeGetDurableObjectStorage(WORKER_NAME, CLASS_NAME, {
      name: objectName,
    });
    const call = async (command: CacheFixtureCommand): Promise<unknown> => {
      const stub = namespace.get(namespace.idFromName(objectName));
      const response = await stub.fetch('https://cache.test/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (response.status !== 200) throw new Error(`Evidence cache fixture returned HTTP ${response.status}`);
      return await response.json();
    };

    if (options.initialize !== false && !isInitializedResponse(await call({ operation: 'initialize' }))) {
      throw new Error('Evidence cache fixture failed to initialize');
    }

    let disposed = false;
    return {
      call,
      async exec(sql: string, ...bindings: SqlStorageValue[]): Promise<readonly Record<string, SqlStorageValue>[]> {
        return await adminStorage.exec(sql, ...bindings);
      },
      async restart(): Promise<void> {
        if (disposed) throw new Error('Cannot restart disposed cache fixture');
        await activeRuntime.dispose();
        activeRuntime = createRuntime(stateDir, modules);
        runtime = activeRuntime;
        namespace = await activeRuntime.getDurableObjectNamespace(BINDING_NAME, WORKER_NAME);
        adminStorage = await activeRuntime.unsafeGetDurableObjectStorage(WORKER_NAME, CLASS_NAME, { name: objectName });
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        try {
          await activeRuntime.dispose();
        } finally {
          await rm(stateDir, { recursive: true, force: true });
        }
      },
    };
  } catch (cause) {
    try {
      await runtime?.dispose();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
    throw cause;
  }
}
