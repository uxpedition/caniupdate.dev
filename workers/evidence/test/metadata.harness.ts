import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Log, LogLevel, Miniflare, type V4FetchHandler } from 'miniflare';

const execFileAsync = promisify(execFile);

let bundle: Promise<Record<string, { type: 'esm'; contents: string }>> | undefined;

async function bundleEvidence() {
  const directory = await mkdtemp(join(tmpdir(), 'metadata-worker-bundle-'));

  try {
    await execFileAsync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--dry-run',
      '--config',
      'workers/evidence/wrangler.jsonc',
      '--env=',
      '--outdir',
      directory,
    ]);
    const modules: Record<string, { type: 'esm'; contents: string }> = {};

    for (const file of await readdir(directory)) {
      if (file.endsWith('.js'))
        modules[file] = { type: 'esm', contents: await readFile(join(directory, file), 'utf8') };
    }

    return modules;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Runs the production PackageEvidence class; only its external HTTP provider is replaced. */
export async function openMetadataFixture(provider: V4FetchHandler, packageName = '@scope/example') {
  bundle ??= bundleEvidence();
  const modules = await bundle;
  const state = await mkdtemp(join(tmpdir(), 'metadata-worker-state-'));

  const createRuntime = () =>
    new Miniflare({
      log: new Log(LogLevel.ERROR),
      resourcePersistencePath: state,
      unsafeInspectDurableObjects: true,
      workers: [
        {
          config: {
            name: 'metadata-test',
            compatibilityDate: '2026-09-25',
            compatibilityFlags: ['nodejs_compat'],
            manifest: { mainModule: 'index.js', modules },
            env: {
              PACKAGE_EVIDENCE: { type: 'durable-object', worker: 'metadata-test', exportName: 'PackageEvidence' },
            },
            exports: { PackageEvidence: { type: 'durable-object', storage: 'sqlite' } },
          },
          dev: { outboundService: { type: 'fetcher', handler: provider } },
        },
      ],
    });

  let runtime = createRuntime();

  return {
    async request(input = { packageName }) {
      const namespace = await runtime.getDurableObjectNamespace('PACKAGE_EVIDENCE', 'metadata-test');

      return namespace.get(namespace.idFromName(packageName)).fetch('https://package-evidence/metadata', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
    async storage() {
      return runtime.unsafeGetDurableObjectStorage('metadata-test', 'PackageEvidence', { name: packageName });
    },
    async restart() {
      await runtime.dispose();
      runtime = createRuntime();
    },
    async dispose() {
      try {
        await runtime.dispose();
      } finally {
        await rm(state, { recursive: true, force: true });
      }
    },
  };
}
