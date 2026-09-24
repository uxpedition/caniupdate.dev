import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const nuxt = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url));
const children = new Set<ChildProcess>();
let stopping = false;

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 5_000);
  timer.unref();
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

// Migrations complete before either runtime owns the persistent bindings.
const migration = spawn(
  process.execPath,
  [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'BRIEFINGS_DB',
    '--local',
    '--config',
    'wrangler.jsonc',
    '--persist-to',
    '.wrangler/state',
  ],
  { cwd: root, stdio: 'inherit' },
);
children.add(migration);
const migrationCode = await new Promise<number>((resolve, reject) => {
  migration.once('error', reject);
  migration.once('exit', (code) => {
    children.delete(migration);
    resolve(code ?? 1);
  });
});

if (migrationCode !== 0 || stopping) {
  stop(migrationCode || 1);
} else {
  // HTTP DO stubs in Nitro's getPlatformProxy discover this local Wrangler session.
  // Keep backend variables beside its config; never copy frontend AI credentials into it.
  const backend = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--config',
      'workers/evidence/wrangler.jsonc',
      '--persist-to',
      '.wrangler/state',
      '--port',
      '8790',
      '--inspector-port',
      '9230',
    ],
    { cwd: root, stdio: ['inherit', 'pipe', 'inherit'] },
  );
  children.add(backend);
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Evidence Worker did not become ready')), 30_000);
      const onOutput = (chunk: Buffer) => {
        process.stdout.write(chunk);
        output = (output + chunk.toString()).slice(-4_096);
        if (/Ready on https?:\/\//.test(output)) {
          clearTimeout(timer);
          resolve();
        }
      };
      backend.stdout.on('data', onOutput);
      backend.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
        stop(1);
      });
      backend.once('exit', (code) => {
        children.delete(backend);
        clearTimeout(timer);
        reject(new Error('Evidence Worker exited before readiness'));
        stop(code ?? 1);
      });
    });
    if (!stopping) {
      const frontend = spawn(process.execPath, [nuxt, 'dev', '--host', '0.0.0.0', '--port', '5173'], {
        cwd: root,
        stdio: 'inherit',
      });
      children.add(frontend);
      frontend.once('error', (error) => {
        console.error(error);
        stop(1);
      });
      frontend.once('exit', (code) => {
        children.delete(frontend);
        stop(code ?? 1);
      });
    }
  } catch (error) {
    if (!stopping) console.error(error);
    stop(1);
  }
}
