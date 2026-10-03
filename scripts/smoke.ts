// The reproducible local scenario for the three-runtime launcher, run against an isolated persistence root so it
// never touches `.wrangler/state`:
//
//   node scripts/smoke.ts [--preview] [--measure] [--keep]
//
// It starts the loopback fixture provider the briefing Worker's `.dev.vars` names, starts `scripts/dev.ts` with its
// own ports, then drives the real browser-facing path — POST, socket `available`, a device-shaped Origin on this
// machine's own address, restart, D1 hit, reconnect — and asserts that a settled job costs no second provider call.
// `--measure` adds the Free-tier CPU sampling; `--keep` leaves the temporary persistence root in place for inspection.
//
// Nothing here deploys, calls a remote environment, or reads a credential: the provider is a loopback fixture and the
// only secrets involved are the fixture values in the git-ignored `workers/briefing/.dev.vars`.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { startProviderFixture, type ProviderFixture } from '../workers/briefing/test/provider.stub.ts';
import { readTrees, type RuntimePids } from './smokeCpu.ts';
import { openSubscription, type Subscription } from './smokeSocket.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const devVarsPath = join(root, 'workers', 'briefing', '.dev.vars');
const builtFrontendConfig = join(root, '.output', 'server', 'wrangler.json');

const PACKAGE_NAME = 'minimist';
const SETTLED_FROM = '1.2.5';
const SETTLED_TO = '1.2.8';
/** A second pair, so `--measure` can time a cold generation instead of the D1 hit the scenario settles. */
const COLD_FROM = '1.2.5';
const COLD_TO = '1.2.6';
/** A third pair, generated for the device-shaped Origin check, so `--measure`'s cold pair stays cold. */
const REMOTE_FROM = '1.2.7';
const REMOTE_TO = '1.2.8';
/** A larger package for `--measure`: the frontend re-serializes the whole bounded packet on every POST. */
const LARGE_PACKAGE_NAME = 'vue';
const LARGE_FROM = '3.4.38';
const LARGE_TO = '3.5.13';

/** Offset from the documented 8790/8791/5173 so the scenario can run beside a live development session. */
const EVIDENCE_PORT = 8890;
const BRIEFING_PORT = 8891;
const FRONTEND_PORT = 5273;
/** Offset from the documented 9230, so a live session's inspector ports stay free. */
const INSPECTOR_BASE = 9330;

const FRONTEND_ORIGIN = `http://localhost:${FRONTEND_PORT}`;
const HASH_PATH = /^\/api\/briefings\/([0-9a-f]{64})\/events$/;

const HEALTH_TIMEOUT_MS = 180_000;
const SUBSCRIPTION_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * The submission envelope the route promises, decoded strictly with the same library the application uses: the
 * scenario asserts the wire contract instead of trusting whatever the route happened to answer.
 */
const SubmissionSchema = Schema.Struct({
  status: Schema.Literals(['available', 'queued', 'running']),
  packageName: Schema.String,
  from: Schema.String,
  to: Schema.String,
  eventsUrl: Schema.optional(Schema.String),
  hash: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.Natural),
});

type BriefingSubmission = typeof SubmissionSchema.Type;

const decodeSubmission = Schema.decodeUnknownSync(SubmissionSchema, { errors: 'all' });

/** Every assertion failure in this scenario carries the command and the observed output, never just a verdict. */
class SmokeFailure extends Error {
  override readonly name = 'SmokeFailure';
}

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new SmokeFailure(message);
};

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/**
 * The provider port comes from the briefing Worker's own local settings, so the scenario cannot drift from the
 * endpoint the runtime actually reads. A non-loopback endpoint is refused rather than contacted: this scenario must
 * never spend a real generation.
 */
const fixtureProviderPort = async (): Promise<number> => {
  const contents = await readFile(devVarsPath, 'utf8').catch(() => undefined);
  if (contents === undefined) {
    throw new SmokeFailure(
      `Missing ${devVarsPath}. Create it with a loopback fixture endpoint, for example:\n` +
        '  AI_BRIEFING_ENDPOINT="http://127.0.0.1:8787/v1/chat/completions"\n' +
        '  AI_BRIEFING_API_KEY="local-fixture-key"\n' +
        '  AI_BRIEFING_MODEL="local-fixture-model"',
    );
  }
  const endpoint = /^AI_BRIEFING_ENDPOINT\s*=\s*"?([^"\s]+)"?/m.exec(contents)?.[1];
  if (endpoint === undefined) throw new SmokeFailure(`${devVarsPath} does not set AI_BRIEFING_ENDPOINT`);
  const url = new URL(endpoint);
  check(
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1',
    `Refusing to run: ${devVarsPath} points at ${url.hostname}, not loopback. This scenario only drives a local fixture.`,
  );
  return Number(url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : url.port);
};

// ----------------------------------------------------------------------------------------------------------------
// The launcher

type Launcher = {
  readonly process: ChildProcess;
  readonly output: () => string;
  readonly childPids: () => ReadonlyMap<string, number>;
  readonly stop: () => Promise<void>;
};

const startLauncher = (preview: boolean, persistTo: string): Launcher => {
  const args = [
    'scripts/dev.ts',
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
  const child = spawn(process.execPath, args, {
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
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGINT');
      const timer = setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS);
      const code = await exited;
      clearTimeout(timer);
      log(`  launcher exited with code ${code}`);
    },
  };
};

const waitForHealth = async (launcher: Launcher, timeoutMs: number): Promise<void> => {
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
const portsAreFree = async (): Promise<boolean> => {
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

// ----------------------------------------------------------------------------------------------------------------
// The scenario

/**
 * The Origin a browser on another device sends: the page loaded by this machine's own address, never loopback. The
 * scenario derives it from a real interface address, because that is what the launcher's allow-list and the submission
 * route's re-pointing both have to serve.
 */
const remoteFrontendOrigin = (): string => {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') return `http://${address.address}:${FRONTEND_PORT}`;
    }
  }
  throw new SmokeFailure('This scenario needs one non-loopback IPv4 address to act as another device');
};

const submit = async (
  from: string,
  to: string,
  packageName: string = PACKAGE_NAME,
  origin?: string,
): Promise<{ status: number; body: BriefingSubmission }> => {
  // A device-shaped call reaches the frontend by the address it loaded the page from, so the request carries that
  // Origin and the Host a browser on that device would send.
  const response = await fetch(
    `${origin ?? FRONTEND_ORIGIN}/api/package/${encodeURIComponent(packageName)}/compare/briefing?from=${from}&to=${to}`,
    {
      method: 'POST',
      ...(origin === undefined ? {} : { headers: { Origin: origin } }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body: unknown = await response.json();
  try {
    return { status: response.status, body: decodeSubmission(body) };
  } catch {
    throw new SmokeFailure(`The submission route answered ${response.status} with ${JSON.stringify(body)}`);
  }
};

const waitForAvailable = async (eventsUrl: string, origin: string = FRONTEND_ORIGIN): Promise<Subscription> => {
  const subscription = await openSubscription(eventsUrl, origin, SUBSCRIPTION_TIMEOUT_MS);
  const terminal = subscription.frames.at(-1);
  check(
    terminal?.status === 'available',
    `The subscription ended without an available briefing: ${JSON.stringify(subscription.frames)} ` +
      `(close ${subscription.close.code} ${subscription.close.reason})`,
  );
  return subscription;
};

const describeFrames = (subscription: Subscription): string =>
  subscription.frames.map((frame) => `${frame.status}@${frame.revision}`).join(' -> ') +
  ` (close ${subscription.close.code} ${subscription.close.reason})`;

/** The cold path: POST, follow the socket to its terminal frame, and charge exactly one provider call. */
const submitColdPair = async (from: string, to: string, provider: ProviderFixture): Promise<string> => {
  const before = provider.requestsFor(PACKAGE_NAME);
  const first = await submit(from, to);
  check(
    first.status === 202,
    `Expected a 202 submission for a cold pair, got ${first.status}: ${JSON.stringify(first.body)}`,
  );
  const eventsUrl = first.body.eventsUrl;
  if (eventsUrl === undefined) {
    throw new SmokeFailure(`A queued submission must carry eventsUrl: ${JSON.stringify(first.body)}`);
  }
  const parsed = new URL(eventsUrl);
  check(
    Number(parsed.port) === BRIEFING_PORT,
    `eventsUrl must name the public briefing port ${BRIEFING_PORT}: ${eventsUrl}`,
  );
  check(HASH_PATH.test(parsed.pathname), `eventsUrl must be the hash-addressed events path: ${eventsUrl}`);
  log(`POST ${from}...${to} -> 202 ${first.body.status} ${eventsUrl}`);
  log(`socket -> ${describeFrames(await waitForAvailable(eventsUrl))}`);
  check(
    provider.requestsFor(PACKAGE_NAME) === before + 1,
    `One generation must cost exactly one provider call, observed ${provider.requestsFor(PACKAGE_NAME) - before}`,
  );
  return eventsUrl;
};

/**
 * The other workflow the README documents: a device opens the page by this machine's own address. That submission must
 * answer with the socket on the device's address rather than the loopback the service advertises, and the service must
 * accept that device's Origin — so the scenario speaks to the address itself, never to loopback.
 */
const submitFromDevice = async (): Promise<void> => {
  const deviceOrigin = remoteFrontendOrigin();
  const device = await submit(REMOTE_FROM, REMOTE_TO, PACKAGE_NAME, deviceOrigin);
  check(
    device.status === 202,
    `Expected a 202 submission from ${deviceOrigin}, got ${device.status}: ${JSON.stringify(device.body)}`,
  );
  const deviceEventsUrl = device.body.eventsUrl;
  if (deviceEventsUrl === undefined) {
    throw new SmokeFailure(`A queued submission must carry eventsUrl: ${JSON.stringify(device.body)}`);
  }
  const answered = new URL(deviceEventsUrl);
  check(
    answered.hostname === new URL(deviceOrigin).hostname && Number(answered.port) === BRIEFING_PORT,
    `A submission from ${deviceOrigin} must answer with the socket on that address: ${deviceEventsUrl}`,
  );

  log(`POST as ${deviceOrigin} -> 202 ${device.body.status} ${deviceEventsUrl}`);
  log(`socket from ${deviceOrigin} -> ${describeFrames(await waitForAvailable(deviceEventsUrl, deviceOrigin))}`);
};

const runScenario = async (preview: boolean, persistTo: string, provider: ProviderFixture): Promise<Launcher> => {
  log(`scenario: ${preview ? 'preview (built frontend)' : 'dev (Nuxt HMR)'}, persistence root ${persistTo}`);
  const launcher = startLauncher(preview, persistTo);
  try {
    await waitForHealth(launcher, HEALTH_TIMEOUT_MS);
    log(`frontend healthy on ${FRONTEND_ORIGIN}`);

    const eventsUrl = await submitColdPair(SETTLED_FROM, SETTLED_TO, provider);
    await submitFromDevice();

    await launcher.stop();
    check(await portsAreFree(), 'Shutdown must release the evidence, briefing, and frontend ports');

    // The restart proves two things at once: state under this root survives, and a settled job answers from D1.
    const restarted = startLauncher(preview, persistTo);
    await waitForHealth(restarted, HEALTH_TIMEOUT_MS);
    const afterRestart = provider.requestsFor(PACKAGE_NAME);
    const second = await submit(SETTLED_FROM, SETTLED_TO);
    check(
      second.status === 200 && second.body.status === 'available',
      `A restarted runtime must answer from D1 with 200 available, got ${second.status}: ${JSON.stringify(second.body)}`,
    );
    log('POST after restart -> 200 available (D1 hit)');
    check(provider.requestsFor(PACKAGE_NAME) === afterRestart, 'A D1 hit must not call the provider');

    log(`reconnect -> ${describeFrames(await waitForAvailable(eventsUrl))}`);
    check(provider.requestsFor(PACKAGE_NAME) === afterRestart, 'A socket reconnect must never start inference');
    return restarted;
  } catch (error) {
    await launcher.stop();
    throw error;
  }
};

// ----------------------------------------------------------------------------------------------------------------
// CPU sampling

/**
 * One window's CPU per runtime. `requests` is what the window drove; a zero-request window (the idle baseline) is
 * reported per second instead, so a busy host's background cost is visible rather than folded into a request.
 */
const sample = async (label: string, pids: RuntimePids, requests: number, run: () => Promise<void>): Promise<void> => {
  const before = await readTrees(pids);
  const startedAt = Date.now();
  await run();
  const windowMs = Math.max(Date.now() - startedAt, 1);
  const after = await readTrees(pids);
  const render = (ms: number) =>
    requests === 0 ? `${((ms / windowMs) * 1_000).toFixed(2)} ms/s` : `${(ms / requests).toFixed(3)} ms/req`;
  log(
    `  ${label}: ${requests} request(s) over ${(windowMs / 1_000).toFixed(1)} s -> frontend ${render(after.frontend - before.frontend)}, ` +
      `briefing ${render(after.briefing - before.briefing)}, evidence ${render(after.evidence - before.evidence)}`,
  );
};

const warmBurst = async (requests: number, from: string, to: string, packageName: string): Promise<void> => {
  for (let index = 0; index < requests; index += 1) {
    const response = await submit(from, to, packageName);
    check(response.status === 200, `Warm POST ${index} answered ${response.status}`);
  }
};

const runMeasurements = async (launcher: Launcher, provider: ProviderFixture): Promise<void> => {
  const childPids = launcher.childPids();
  const pids: RuntimePids = {
    frontend: childPids.get('Frontend'),
    briefing: childPids.get('Briefing worker'),
    evidence: childPids.get('Evidence worker'),
  };
  check(
    pids.frontend !== undefined && pids.briefing !== undefined && pids.evidence !== undefined,
    `The launcher must log all three child PIDs, saw ${JSON.stringify([...childPids])}`,
  );
  log('CPU samples (whole process tree per runtime, /proc schedstat; includes runtime bookkeeping):');

  await sample('idle baseline', pids, 0, async () => {
    await delay(5_000);
  });

  const warmPosts = 30;
  await sample(`warm POST (D1 hit) x${warmPosts}`, pids, warmPosts, async () => {
    await warmBurst(warmPosts, SETTLED_FROM, SETTLED_TO, PACKAGE_NAME);
  });

  // The local Queue delivers as soon as the object sends, so submission, consumer, and job object can overlap one
  // window. The warm sample above isolates the submission path; this one covers a whole generation.
  let coldEventsUrl = '';
  await sample('cold POST to terminal frame', pids, 1, async () => {
    coldEventsUrl = await submitColdPair(COLD_FROM, COLD_TO, provider);
  });

  await sample('settled socket reconnect', pids, 1, async () => {
    const before = provider.requestsFor(PACKAGE_NAME);
    await waitForAvailable(coldEventsUrl);
    check(provider.requestsFor(PACKAGE_NAME) === before, 'A reconnect must not call the provider');
  });

  const subscriberCount = 8;
  await sample('concurrent settled subscribers', pids, subscriberCount, async () => {
    const subscriptions = await Promise.all(
      Array.from({ length: subscriberCount }, () =>
        openSubscription(coldEventsUrl, FRONTEND_ORIGIN, SUBSCRIPTION_TIMEOUT_MS),
      ),
    );
    for (const subscription of subscriptions) {
      check(
        subscription.frames.at(-1)?.status === 'available',
        `A concurrent subscriber did not receive the briefing: ${JSON.stringify(subscription.frames)}`,
      );
      check(subscription.close.code === 1000, `A settled subscriber closes normally, got ${subscription.close.code}`);
    }
  });

  // The frontend carries the whole bounded packet on every submission, so a larger package is the CPU-relevant case.
  const large = await submit(LARGE_FROM, LARGE_TO, LARGE_PACKAGE_NAME);
  check(large.status === 202 || large.status === 200, `Large-package POST answered ${large.status}`);
  if (large.status === 202 && large.body.eventsUrl !== undefined) await waitForAvailable(large.body.eventsUrl);
  await sample(`${LARGE_PACKAGE_NAME} warm POST (D1 hit) x${warmPosts}`, pids, warmPosts, async () => {
    await warmBurst(warmPosts, LARGE_FROM, LARGE_TO, LARGE_PACKAGE_NAME);
  });
};

// ----------------------------------------------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const preview = argv.includes('--preview');
  const measure = argv.includes('--measure');
  const keep = argv.includes('--keep');

  if (preview) {
    const built = await readFile(builtFrontendConfig, 'utf8').catch(() => undefined);
    if (built === undefined) {
      throw new SmokeFailure(`Missing ${builtFrontendConfig}. Run \`nub run build\` before --preview.`);
    }
  }

  const persistTo = await mkdtemp(join(tmpdir(), 'can-i-update-smoke-'));
  const port = await fixtureProviderPort();
  const provider = await startProviderFixture({ port });
  log(`fixture provider listening on 127.0.0.1:${port} (loopback, no real credential)`);
  let launcher: Launcher | undefined;
  let failure: unknown;
  try {
    launcher = await runScenario(preview, persistTo, provider);
    log('scenario: PASS (POST -> socket available -> restart -> D1 hit -> reconnect with no provider call)');
    if (measure) await runMeasurements(launcher, provider);
  } catch (error) {
    failure = error;
  } finally {
    if (launcher !== undefined) await launcher.stop();
    await provider.close();
    if (keep) log(`kept the isolated persistence root at ${persistTo}`);
    else await rm(persistTo, { recursive: true, force: true });
  }

  if (failure !== undefined) {
    const detail = failure instanceof Error ? (failure.stack ?? failure.message) : String(failure);
    log(`scenario: FAIL\n${detail}`);
    process.exitCode = 1;
    return;
  }
  log('scenario: DONE');
};

await main();
