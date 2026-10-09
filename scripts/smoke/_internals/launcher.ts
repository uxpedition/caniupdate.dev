// The launcher under test: the three-runtime supervisor (`scripts/dev/dev.ts`) as the scenario drives it. Spawning keeps
// the bounded output log and the child PIDs the CPU sampler needs; shutdown escalates to SIGKILL so a wedged Wrangler
// session cannot keep this scenario's port bindings alive against the next run.

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  BRIEFING_PORT,
  EVIDENCE_PORT,
  FRONTEND_ORIGIN,
  FRONTEND_PORT,
  INSPECTOR_BASE,
  SHUTDOWN_TIMEOUT_MS,
  SmokeFailure,
  log,
  root,
} from './defs.ts';

/** The launcher handle: bounded output, the child PIDs each runtime logged, and the shutdown promise. */
export type Launcher = {
  readonly process: ChildProcess;
  readonly output: () => string;
  readonly childPids: () => ReadonlyMap<string, number>;
  readonly stop: () => Promise<void>;
};

const launcherArgs = (preview: boolean, persistTo: string): readonly string[] => [
  'scripts/dev/dev.ts',
  ...(preview ? ['--preview'] : []),
  '--persist-to',
  persistTo,
  '--evidence-port',
  String(EVIDENCE_PORT),
  '--briefing-port',
  String(BRIEFING_PORT),
  '--frontend-port',
  String(FRONTEND_PORT),
  '--inspector-base',
  String(INSPECTOR_BASE),
];

/** Shutdown releases the ports only once the launcher is gone: SIGINT first, SIGKILL after the grace window. */
const stopProcess = async (child: ChildProcess, exited: Promise<number>): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
  const timer = setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS);
  const code = await exited;
  clearTimeout(timer);
  log(`  launcher exited with code ${code}`);
};

/** Starts the launcher against this scenario's own persistence root and ports; never the normal `.wrangler/state`. */
export const startLauncher = (preview: boolean, persistTo: string): Launcher => {
  const child = spawn(process.execPath, launcherArgs(preview, persistTo), {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    // A private dev registry keeps this scenario's sessions (and their worker names) away from any live development
    // session: without it, two sessions registering `can-i-update-local-evidence` would fight over one registry entry.
    env: { ...process.env, WRANGLER_REGISTRY_PATH: join(persistTo, 'registry') },
  });
  let output = '';
  const childPids = new Map<string, number>();
  const capture = (chunk: Buffer, stream: 'out' | 'err') => {
    const text = chunk.toString('utf8');
    output = `${output}${text}`.slice(-32_768);
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      log(`  [launcher:${stream}] ${line}`);
      const pid = /(Evidence worker|Briefing worker|Frontend) child PID: (\d+)/.exec(line);
      if (pid?.[1] !== undefined && pid[2] !== undefined) childPids.set(pid[1], Number(pid[2]));
    }
  };
  child.stdout?.on('data', (chunk: Buffer) => capture(chunk, 'out'));
  child.stderr?.on('data', (chunk: Buffer) => capture(chunk, 'err'));
  const exited = new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? -1)));
  let stopping = false;
  return {
    process: child,
    output: () => output,
    childPids: () => childPids,
    stop: async () => {
      if (stopping) return;
      stopping = true;
      await stopProcess(child, exited);
    },
  };
};

export const waitForHealth = async (launcher: Launcher, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launcher.process.exitCode !== null) {
      throw new SmokeFailure(`The launcher exited with code ${launcher.process.exitCode}:\n${launcher.output()}`);
    }
    try {
      const response = await fetch(`${FRONTEND_ORIGIN}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await delay(500);
  }
  throw new SmokeFailure(
    `The frontend on ${FRONTEND_ORIGIN} was not healthy within ${timeoutMs} ms:\n${launcher.output()}`,
  );
};

/** Every port the launcher used must be free again, or shutdown left a runtime behind. */
export const portsAreFree = async (): Promise<boolean> => {
  const attempts = await Promise.all(
    [EVIDENCE_PORT, BRIEFING_PORT, FRONTEND_PORT].map(
      (port) =>
        new Promise<boolean>((resolve) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.once('connect', () => {
            socket.destroy();
            resolve(false);
          });
          socket.once('error', () => resolve(true));
        }),
    ),
  );
  return attempts.every(Boolean);
};
