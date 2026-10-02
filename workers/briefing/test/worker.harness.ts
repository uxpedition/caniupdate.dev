// The shared Miniflare runtime harness for the briefing Worker's integration suites. Every case runs the real Worker
// bundle, a real SQLite-backed Durable Object, a real Queue producer/consumer and a real D1 database inside one
// Miniflare instance; the `sockets.unit/` suites additionally drive the real hibernating WebSocket API. Faults are
// produced by real mechanisms (a dropped table, a refusing SQLite trigger, a stalled provider response, a disposed or
// evicted runtime); nothing here mocks the state machine.
//
// Test-only code lives in a `test/` directory beside what it exercises and is named for what it does: a
// `*.harness.ts` boots a real runtime and hands back handles plus teardown, a `*.stub.ts` impersonates an external
// system. The `*.unit.ts` suffix is reserved for suites — vitest collects by it, and `test/**` carries the same
// relaxed lint rules those suites get.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { D1Database, Queue } from '@cloudflare/workers-types';
import { Log, LogLevel, Miniflare, type DispatchFetch, type WebSocket as RuntimeWebSocket } from 'miniflare';

import type { AvailablePackageBriefing, BriefingEvidence } from '#shared/briefing.defs';
import {
  decodeBriefingJobEvent,
  decodeBriefingSubmission,
  type BriefingJobEvent,
  type BriefingSubmission,
} from '#shared/briefingJob.defs';

import { briefingEvidenceHash } from '../../../server/utils/packageBriefing';
import { readStoredBriefing } from '../../../server/utils/packageBriefingStore';
import type { BriefingJobMessage } from '../job';
import { FIXTURE_API_KEY, MODEL, SOURCE_ID, providerFixture } from './provider.stub';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const MIGRATION_PATH = join(REPO_ROOT, 'migrations', '0001_package_briefings.sql');
export const WORKER_NAME = 'can-i-update-local-briefing';
const HARNESS_NAME = 'briefing-submission-harness';
const HARNESS_MODULE = 'harness.js';
const QUEUE_NAME = 'can-i-update-local-briefings';
const D1_ID = 'can-i-update-local-briefings';
export const PUBLIC_URL = 'ws://localhost:8791';

const POLL_MS = 100;
const D1_WAIT_MS = 30_000;
export const JOB_WAIT_MS = 30_000;
/** A window in which an unwanted provider call would have happened, for negative assertions. */
export const QUIET_MS = 2_000;
export const LEASE_WAIT_MS = 150_000;

/**
 * The two configurations `workers/briefing/wrangler.jsonc` declares, mirrored exactly: the default environment is
 * local-only, and `env.preview` is the deployed hostname and site origin. Tests exercise both, because the Origin
 * check is a value, not a constant.
 */
const ENVIRONMENTS = {
  local: {
    publicUrl: PUBLIC_URL,
    requests: 'http://localhost:8791',
    allowedOrigin: 'http://localhost:5173',
  },
  preview: {
    publicUrl: 'wss://can-i-update-preview-briefing.caniupdate-dev.workers.dev',
    requests: 'https://can-i-update-preview-briefing.caniupdate-dev.workers.dev',
    allowedOrigin: 'https://can-i-update-preview.caniupdate-dev.workers.dev',
  },
} as const;

export type BriefingEnvironment = keyof typeof ENVIRONMENTS;

/** Exported so a test can hand one configuration's Origin to another configuration's Worker. */
export const BRIEFING_ENVIRONMENTS = ENVIRONMENTS;

/**
 * Miniflare's own queue broker logs one INFO line per message batch it hands to the consumer
 * (`QUEUE <name> <acked>/<total>`). With this fixture's `maxBatchSize: 1` and `maxBatchTimeout: 0` every send flushes
 * on its own, so counting these lines counts messages that reached the Queue and were delivered — the producer-side
 * counter no other hook exposes. A suite that asserts "zero" also observes a known delivery, so a Miniflare change
 * to this line fails loudly instead of silently reporting nothing.
 */
const QUEUE_DELIVERY = new RegExp(String.raw`QUEUE\s+${QUEUE_NAME}\s+\d+/\d+`);
// Miniflare's broker colours that line when it thinks it is on a TTY; strip escape codes before matching.
// oxlint-disable-next-line no-control-regex -- matching terminal colour escapes is the point of this expression.
const ANSI = /\u001B\[[0-9;]*m/g;

/** Captures every line the runtime logs, so a test can count real queue deliveries. */
class RecordingLog extends Log {
  readonly lines: string[] = [];

  override logWithLevel(level: LogLevel, message: string): void {
    void level;
    this.lines.push(message);
  }
}

export const packetFor = (packageName: string, from: string, to: string): BriefingEvidence => ({
  packageName,
  from,
  to,
  sources: [
    {
      number: 1,
      id: SOURCE_ID,
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: [`https://registry.npmjs.org/${packageName}/${from}`, `https://registry.npmjs.org/${packageName}/${to}`],
      text: JSON.stringify({ changed: true, from: '>=14', to: '>=20' }),
    },
    { number: 2, id: 'coverage', kind: 'coverage', label: 'Evidence coverage and limitations', urls: [], text: '{}' },
  ],
  gaps: ['fixture'],
});

// The private submission entrypoint's address space: the harness Worker holds a real service binding to it.
const HARNESS_SCRIPT = `
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const readBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};
const jobStub = (env, hash) => {
  const jobs = env.BRIEFING_JOBS;
  return jobs.get(jobs.idFromName(hash));
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/submit' || url.pathname === '/job-submit') {
      const packet = await readBody(request);
      try {
        const submission =
          url.pathname === '/submit'
            ? JSON.parse(await env.BRIEFING_SERVICE.submit(packet))
            : await jobStub(env, url.searchParams.get('hash') ?? '').submit(packet);
        return json(submission);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'submission failed' }, 503);
      }
    }

    if (url.pathname === '/raw-submit') {
      const packet = await readBody(request);
      try {
        const raw = await env.BRIEFING_SERVICE.submit(packet);
        return json({
          kind: typeof raw,
          symbols:
            typeof raw === 'object' && raw !== null
              ? Reflect.ownKeys(raw).filter((key) => typeof key === 'symbol').map(String)
              : [],
          text: typeof raw === 'string' ? raw : null,
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'submission failed' }, 503);
      }
    }

    if (url.pathname === '/job') {
      try {
        return json(await jobStub(env, url.searchParams.get('hash') ?? '').reconciledSnapshot());
      } catch {
        return json({ error: 'no job' }, 404);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
`;

export type SubmitResult = {
  readonly httpStatus: number;
  readonly submission: BriefingSubmission | undefined;
  readonly error: string | undefined;
};

/**
 * What the `BriefingSubmitter` entrypoint answered across the service binding, before any JSON conversion: the
 * value's `typeof`, the own symbol keys on it when it is an object, and the text itself when it is a string. The
 * symbols are the only channel through which the harness can report workerd's own-`Symbol.dispose` decoration, since
 * `json()` would drop it.
 */
export type RawSubmission = {
  readonly httpStatus: number;
  /** `typeof` the value the entrypoint returned; a contract-conforming answer is `'string'`. */
  readonly kind: string | undefined;
  /** Own symbol keys of an object answer. Empty for the JSON-text contract, which cannot carry any. */
  readonly symbols: readonly string[];
  /** The answer itself when it crossed as JSON text. */
  readonly text: string | undefined;
  readonly error: string | undefined;
};

/** The queued/running envelope, narrowed: tests assert hashes and revisions, which only a pending job carries. */
export function pendingOf(result: SubmitResult): Extract<BriefingSubmission, { status: 'queued' | 'running' }> {
  const { submission } = result;
  if (submission === undefined || submission.status === 'available') {
    throw new Error(`Expected a queued or running submission, received ${JSON.stringify(result)}`);
  }
  return submission;
}

export type RuntimeFixture = {
  readonly database: D1Database;
  readonly queue: Queue<BriefingJobMessage> | undefined;
  /** This runtime's raw `BRIEFING_ALLOWED_ORIGIN`: one Origin, unless a case overrode it with a list. */
  readonly allowedOrigin: string;
  /** The absolute public route a browser dials for this hash, built from this runtime's `BRIEFING_PUBLIC_URL`. */
  eventsUrl(hash: string): string;
  /** Queue messages this runtime's own broker delivered to the consumer; see `QUEUE_DELIVERY`. */
  queueDeliveries(): number;
  /** One request against the public hostname, through the real runtime, exactly as a browser sends it. */
  publicFetch: DispatchFetch;
  submit(packet: unknown): Promise<SubmitResult>;
  /** The same real service-binding call, reported unconverted so a test can assert the wire contract itself. */
  rawSubmit(packet: unknown): Promise<RawSubmission>;
  submitToJob(hash: string, packet: unknown): Promise<SubmitResult>;
  jobEvent(hash: string): Promise<BriefingJobEvent | undefined>;
  publicPost(url: string, body: unknown): Promise<{ status: number; text: string }>;
  /**
   * Miniflare's real object eviction: workerd deactivates the object and, because hibernation is requested, keeps its
   * accepted sockets attached for whatever wakes it next. This is the eviction a production runtime performs on its
   * own, not a second object standing in for one.
   */
  evictJob(hash: string): Promise<void>;
  dispose(): Promise<void>;
};

export type RuntimeOptions = {
  readonly stateDir: string;
  /** A runtime started without the three AI settings, to prove D1 reuse needs no provider configuration. */
  readonly aiConfig?: boolean;
  readonly producer?: boolean;
  readonly consumer?: boolean;
  /** Off when a case deliberately removed the table and the restart must observe that state. */
  readonly installSchema?: boolean;
  /** Which shipped configuration's vars to run with. Defaults to the local default environment. */
  readonly environment?: BriefingEnvironment;
  /**
   * The raw `BRIEFING_ALLOWED_ORIGIN` value, when a case needs a list — or an empty list — instead of the shipped
   * single Origin.
   */
  readonly allowedOrigin?: string;
};

/** The Worker bundle is built once by the repo's own Wrangler, exactly as the deploy path builds it. */
let workerBundle: Promise<Record<string, { type: 'esm'; contents: string }>> | undefined;

async function bundleWorker(): Promise<Record<string, { type: 'esm'; contents: string }>> {
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

export async function installBriefingSchema(database: D1Database): Promise<void> {
  await database.prepare(await readFile(MIGRATION_PATH, 'utf8')).run();
}

export async function startRuntime(options: RuntimeOptions): Promise<RuntimeFixture> {
  workerBundle ??= bundleWorker();
  const modules = await workerBundle;
  const environment = ENVIRONMENTS[options.environment ?? 'local'];
  const allowedOrigin = options.allowedOrigin ?? environment.allowedOrigin;
  const log = new RecordingLog(LogLevel.INFO);

  // Miniflare 5 declares every environment entry as a binding, so plain variables use the `text` variant.
  const briefingEnv: Record<string, unknown> = {
    BRIEFINGS_DB: { type: 'd1', id: D1_ID },
    BRIEFING_PUBLIC_URL: { type: 'text', value: environment.publicUrl },
    BRIEFING_ALLOWED_ORIGIN: { type: 'text', value: allowedOrigin },
  };
  if (options.producer !== false) briefingEnv.BRIEFING_QUEUE = { type: 'queue', name: QUEUE_NAME };
  if (options.aiConfig !== false) {
    briefingEnv.AI_BRIEFING_ENDPOINT = { type: 'text', value: providerFixture().endpoint };
    briefingEnv.AI_BRIEFING_API_KEY = { type: 'text', value: FIXTURE_API_KEY };
    briefingEnv.AI_BRIEFING_MODEL = { type: 'text', value: MODEL };
  }

  const runtime = new Miniflare({
    log,
    resourcePersistencePath: options.stateDir,
    workers: [
      {
        config: {
          name: WORKER_NAME,
          compatibilityDate: '2026-09-16',
          compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2'],
          env: {
            ...briefingEnv,
            BRIEFING_JOBS: { type: 'durable-object', worker: WORKER_NAME, exportName: 'BriefingJob' },
          },
          exports: { BriefingJob: { type: 'durable-object', storage: 'sqlite' } },
          manifest: { mainModule: 'index.js', modules },
          ...(options.consumer === false
            ? {}
            : { triggers: [{ type: 'queue', name: QUEUE_NAME, maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 2 }] }),
        },
      },
      {
        config: {
          name: HARNESS_NAME,
          compatibilityDate: '2026-09-16',
          compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2'],
          env: {
            BRIEFING_SERVICE: { type: 'worker', worker: WORKER_NAME, exportName: 'BriefingSubmitter' },
            BRIEFING_JOBS: { type: 'durable-object', worker: WORKER_NAME, exportName: 'BriefingJob' },
          },
          manifest: {
            mainModule: HARNESS_MODULE,
            modules: { [HARNESS_MODULE]: { type: 'esm', contents: HARNESS_SCRIPT } },
          },
        },
      },
    ],
  });

  try {
    const worker = await runtime.getWorker(WORKER_NAME);
    const harness = await runtime.getWorker(HARNESS_NAME);
    const database: D1Database = await runtime.getD1Database('BRIEFINGS_DB', WORKER_NAME);
    const queue: Queue<BriefingJobMessage> | undefined =
      options.producer === false
        ? undefined
        : await runtime.getQueueProducer<BriefingJobMessage>('BRIEFING_QUEUE', WORKER_NAME);
    if (options.installSchema !== false) await installBriefingSchema(database);

    const callHarness = async (path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
      const response = await harness.fetch(`https://harness.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };

    const readSubmitResult = (status: number, body: unknown): SubmitResult => {
      if (status !== 200) return { httpStatus: status, submission: undefined, error: rejectionReason(body) };
      return { httpStatus: status, submission: decodeBriefingSubmission(body), error: undefined };
    };

    const readRawSubmission = (status: number, body: unknown): RawSubmission => {
      if (status !== 200 || typeof body !== 'object' || body === null) {
        return { httpStatus: status, kind: undefined, symbols: [], text: undefined, error: rejectionReason(body) };
      }
      return {
        httpStatus: status,
        kind: 'kind' in body && typeof body.kind === 'string' ? body.kind : undefined,
        symbols: 'symbols' in body && Array.isArray(body.symbols) ? body.symbols.map((symbol) => String(symbol)) : [],
        text: 'text' in body && typeof body.text === 'string' ? body.text : undefined,
        error: undefined,
      };
    };

    return {
      database,
      queue,
      allowedOrigin,
      eventsUrl: (hash: string): string => `${environment.requests}/api/briefings/${hash}/events`,
      queueDeliveries: (): number => log.lines.filter((line) => QUEUE_DELIVERY.test(line.replace(ANSI, ''))).length,
      publicFetch: (input, init) => runtime.dispatchFetch(input, init),
      async submit(packet: unknown): Promise<SubmitResult> {
        const { status, body } = await callHarness('/submit', packet);
        return readSubmitResult(status, body);
      },
      async rawSubmit(packet: unknown): Promise<RawSubmission> {
        const { status, body } = await callHarness('/raw-submit', packet);
        return readRawSubmission(status, body);
      },
      async submitToJob(hash: string, packet: unknown): Promise<SubmitResult> {
        const { status, body } = await callHarness(`/job-submit?hash=${hash}`, packet);
        return readSubmitResult(status, body);
      },
      async jobEvent(hash: string): Promise<BriefingJobEvent | undefined> {
        const response = await harness.fetch(`https://harness.test/job?hash=${hash}`);
        if (response.status !== 200) return undefined;
        return decodeBriefingJobEvent(await response.json());
      },
      async publicPost(url: string, body: unknown): Promise<{ status: number; text: string }> {
        const response = await worker.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, text: await response.text() };
      },
      async evictJob(hash: string): Promise<void> {
        await runtime.unsafeEvictDurableObject(WORKER_NAME, 'BriefingJob', { name: hash, webSockets: 'hibernate' });
      },
      dispose: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

/** The harness reports a rejected submission as a sanitized `{ error }` body; anything else is an empty reason. */
function rejectionReason(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) return String(body.error);
  return '';
}

/**
 * Park a generation in `running` behind a stalled provider call and kill its runtime before it can commit, which is
 * the crash every restart case starts from. The fault is real — a stalled response and a disposed runtime — so no
 * part of it needs a hook in the Worker.
 */
export async function crashRunningGeneration(stateDir: string, packet: BriefingEvidence): Promise<string> {
  const hash = briefingEvidenceHash(packet);
  const fixture = providerFixture();

  fixture.setMode({ kind: 'stall' });
  const crashed = await startRuntime({ stateDir });
  try {
    const parked = await crashed.submit(packet);
    if (parked.submission?.status !== 'queued') {
      throw new Error(`Expected the crash fixture to park this submission as queued: ${JSON.stringify(parked)}`);
    }
    await waitFor(
      async () => (fixture.requestsFor(packet.packageName) >= 1 ? true : undefined),
      JOB_WAIT_MS,
      'the provider call',
    );
    await waitForJobEvent(crashed, hash, (event) => event.status === 'running');
  } finally {
    await crashed.dispose();
    fixture.setMode({ kind: 'valid' });
    fixture.releaseStalls();
  }
  return hash;
}

/** A bounded condition wait: the same shape the brief specifies for `waitForStoredBriefing`. */
export async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const last = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label} (last: ${last})`, { cause: lastError });
    }
    await delay(POLL_MS);
  }
}

export async function waitForStoredBriefing(
  database: D1Database,
  hash: string,
  timeoutMs = D1_WAIT_MS,
): Promise<AvailablePackageBriefing> {
  return await waitFor(async () => await readStoredBriefing(database, hash), timeoutMs, `the stored briefing ${hash}`);
}

export async function waitForJobEvent(
  fixture: RuntimeFixture,
  hash: string,
  predicate: (event: BriefingJobEvent) => boolean,
  timeoutMs = JOB_WAIT_MS,
): Promise<BriefingJobEvent> {
  return await waitFor(
    async () => {
      const event = await fixture.jobEvent(hash);
      // Throwing rather than returning undefined keeps the last observed event in the timeout's cause.
      if (event === undefined) throw new Error('no job record for this hash');
      if (!predicate(event)) throw new Error(`job event is ${JSON.stringify(event)}`);
      return event;
    },
    timeoutMs,
    `a job event for ${hash}`,
  );
}

const stateDirs: string[] = [];
export async function openStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-state-'));
  stateDirs.push(dir);
  return dir;
}

export async function removeStateDirs(): Promise<void> {
  await Promise.all(stateDirs.map(async (dir) => await rm(dir, { recursive: true, force: true })));
}

/** The close a terminal briefing's subscriber receives: the canonical completion the browser is meant to see. */
export const CLOSE = { code: 1000, reason: 'briefing complete' };

/** One browser-side subscription: the handshake status, the text frames in arrival order, and the server's close. */
export type Subscription = {
  readonly status: number;
  /** Text frames exactly as the Worker sent them; a non-text frame reads as `[binary]` so a decoder failure is loud. */
  readonly frames: readonly string[];
  /** Resolves with the close the server sent; it only settles once the server closes. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  /** The frames decoded as `BriefingJobEvent` envelopes; an illegal frame throws rather than being ignored. */
  events(): BriefingJobEvent[];
  send(message: string): void;
  close(): void;
};

/**
 * Dial the public read-only route for one hash exactly as a browser on the allowed origin would: an upgrade request
 * carrying `Origin`, through the real runtime, then the standard WebSocket API. A refused handshake throws, because a
 * case that expects one asserts on `publicFetch` instead. Returns once the first frame has arrived, so a caller reads
 * `frames` without racing the server.
 */
export async function subscribe(
  fixture: RuntimeFixture,
  hash: string,
  origin: string = fixture.allowedOrigin,
): Promise<Subscription> {
  const response = await fixture.publicFetch(fixture.eventsUrl(hash), {
    headers: { Upgrade: 'websocket', Origin: origin },
  });
  const socket: RuntimeWebSocket | null = response.webSocket;
  if (socket === null) {
    throw new Error(`The public route refused the upgrade for ${hash} with status ${response.status}`);
  }

  const frames: string[] = [];
  const closed = Promise.withResolvers<{ code: number; reason: string }>();
  socket.accept();
  socket.addEventListener('message', (event) => {
    frames.push(typeof event.data === 'string' ? event.data : '[binary]');
  });
  socket.addEventListener('close', (event) => {
    closed.resolve({ code: event.code, reason: event.reason });
  });

  await waitFor(async () => frames.at(0), JOB_WAIT_MS, `the first frame the public route sent for ${hash}`);

  return {
    status: response.status,
    frames,
    closed: closed.promise,
    events: (): BriefingJobEvent[] => frames.map((frame) => decodeBriefingJobEvent(JSON.parse(frame))),
    send: (message: string): void => socket.send(message),
    close: (): void => socket.close(1000, 'test closed'),
  };
}
