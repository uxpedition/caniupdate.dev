// Local, real-Collector privacy smoke for the additive application/native pipelines:
//
//   node scripts/smokeDiagnostics.ts
//
// This uses only the already-cached contrib Collector image, a private loopback sink, and synthetic fixture values.
// It never loads the Grafana exporter while sending telemetry and validates that overlay with fake credentials in an
// offline one-shot subprocess only. It does not use Docker Compose or read account credentials from the environment.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const image = 'otel/opentelemetry-collector-contrib:0.162.0';
const configFiles = [
  ['collector.yaml', '/etc/otelcol/collector.yaml'],
  ['collector.application.yaml', '/etc/otelcol/collector.application.yaml'],
  ['collector.native.yaml', '/etc/otelcol/collector.native.yaml'],
  ['collector.grafana.yaml', '/etc/otelcol/collector.grafana.yaml'],
] as const;
const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const log = (message: string): boolean => process.stdout.write(`${message}\n`);

type OtlpAttribute = { readonly key: string; readonly value: { readonly stringValue: string } };
type OtlpLogRecord = {
  readonly timeUnixNano: string;
  readonly observedTimeUnixNano: string;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly body: { readonly stringValue: string };
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: OtlpAttribute[];
};
type OtlpSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: OtlpAttribute[];
  readonly events: { readonly name: string; readonly timeUnixNano: string; readonly attributes: OtlpAttribute[] }[];
  readonly links: { readonly traceId: string; readonly spanId: string; readonly attributes: OtlpAttribute[] }[];
  readonly status: { readonly code: number; readonly message: string };
};

const attribute = (key: string, stringValue: string): OtlpAttribute => ({ key, value: { stringValue } });

const runDocker = (args: string[], dockerEnv: NodeJS.ProcessEnv): string =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    env: dockerEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });

const configMountArgs = (): string[] =>
  configFiles.flatMap(([fileName, target]) => [
    '--mount',
    `type=bind,source=${join(root, 'telemetry', fileName)},target=${target},readonly`,
  ]);

const configArgs = (includeGrafana: boolean): string[] =>
  [
    '/etc/otelcol/collector.yaml',
    '/etc/otelcol/collector.application.yaml',
    '/etc/otelcol/collector.native.yaml',
    ...(includeGrafana ? ['/etc/otelcol/collector.grafana.yaml'] : []),
  ].map((path) => `--config=file:${path}`);

const validateConfigs = (dockerEnv: NodeJS.ProcessEnv): void => {
  runDocker(
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--pull=never',
      '--env',
      'GRAFANA_OTLP_ENDPOINT=http://127.0.0.1:9/otlp',
      '--env',
      'GRAFANA_OTLP_USERNAME=local-fixture-user',
      '--env',
      'GRAFANA_OTLP_PASSWORD=local-fixture-password',
      ...configMountArgs(),
      image,
      'validate',
      ...configArgs(true),
    ],
    dockerEnv,
  );
};

type CollectorProcess = {
  readonly process: ChildProcess;
  readonly output: () => string;
  readonly status: () => string | undefined;
  readonly port: (containerPort: 4318 | 4319) => Promise<number>;
  readonly stop: () => Promise<void>;
};

const dockerRunArgs = (name: string): string[] => [
  'run',
  '--rm',
  '--name',
  name,
  '--pull=never',
  '--read-only',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true',
  '--publish',
  '127.0.0.1::4318',
  '--publish',
  '127.0.0.1::4319',
  ...configMountArgs(),
  image,
  ...configArgs(false),
];

const appendOutputTail = (previous: string, chunk: Buffer): string =>
  `${previous}${chunk.toString('utf8')}`.slice(-1_000_000);

type CollectorTap = {
  readonly output: () => string;
  readonly status: () => string | undefined;
  readonly exited: Promise<void>;
};

const tapCollector = (child: ChildProcess): CollectorTap => {
  let output = '';
  let exitStatus: string | undefined;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.stdout?.on('data', (chunk: Buffer) => {
    output = appendOutputTail(output, chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output = appendOutputTail(output, chunk);
  });
  child.once('error', (error) => {
    exitStatus = `docker process error: ${error.message}`;
  });
  child.once('exit', (code, signal) => {
    exitStatus = `docker exited (${code ?? signal ?? 'unknown'})`;
  });
  return { output: () => output, status: () => exitStatus, exited };
};

const waitForCollectorPort = async (
  name: string,
  containerPort: 4318 | 4319,
  dockerEnv: NodeJS.ProcessEnv,
  status: () => string | undefined,
): Promise<number> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const failure = status();
    check(failure === undefined, `Collector ${failure}; it did not stay up.`);
    try {
      const published = runDocker(['port', name, `${containerPort}/tcp`], dockerEnv);
      const match = /127\.0\.0\.1:(\d+)/.exec(published);
      if (match?.[1] !== undefined) return Number(match[1]);
    } catch {
      // Docker has not published the dynamically assigned loopback port yet.
    }
    await delay(100);
  }
  throw new Error(`Collector did not publish loopback port ${containerPort} in time.`);
};

const stopCollector = async (
  name: string,
  dockerEnv: NodeJS.ProcessEnv,
  child: ChildProcess,
  exited: Promise<void>,
): Promise<void> => {
  try {
    runDocker(['stop', '--time', '3', name], dockerEnv);
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([
    exited,
    delay(5_000).then(() => {
      child.kill('SIGKILL');
    }),
  ]);
};

const startCollector = (name: string, dockerEnv: NodeJS.ProcessEnv): CollectorProcess => {
  const child = spawn('docker', dockerRunArgs(name), { cwd: root, env: dockerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const tap = tapCollector(child);
  return {
    process: child,
    output: tap.output,
    status: tap.status,
    port: (containerPort: 4318 | 4319) => waitForCollectorPort(name, containerPort, dockerEnv, tap.status),
    stop: () => stopCollector(name, dockerEnv, child, tap.exited),
  };
};

const waitForEndpoint = async (url: string, collector: CollectorProcess): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    check(collector.status() === undefined, `Collector exited before becoming ready: ${collector.status()}.`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error('Collector OTLP/HTTP receiver did not become ready on loopback.');
};

const sendOtlp = async (url: string, payload: unknown): Promise<void> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  check(
    response.ok,
    `Local Collector returned HTTP ${response.status} for ${url.endsWith('/logs') ? 'logs' : 'traces'}.`,
  );
};

const nanos = String(BigInt(Date.now()) * 1_000_000n);
const traceId = '11111111111111111111111111111111';
const spanId = '1111111111111111';
const syntheticMessage =
  'Synthetic diagnostic diagnostics@example.test Bearer fakeBearerCredential authorization=fakeAuthorizationValue npm_fakeCollectorFixtureToken123 https://diagnostics.example.test/path?token=fakeUrlSecret';
const forbiddenMarkers = [
  ['email', 'diagnostics@example.test'],
  ['bearer credential', 'fakeBearerCredential'],
  ['credential assignment', 'fakeAuthorizationValue'],
  ['npm token', 'npm_fakeCollectorFixtureToken123'],
  ['URL query secret', 'fakeUrlSecret'],
  ['resource attribute', 'ResourceSecretFixtureMarker'],
  ['scope attribute', 'ScopeSecretFixtureMarker'],
  ['log attribute', 'LogSecretFixtureMarker'],
  ['span attribute', 'SpanSecretFixtureMarker'],
  ['span event', 'NativeEventSecretFixtureMarker'],
  ['span link', 'NativeLinkSecretFixtureMarker'],
  ['status message', 'NativeStatusSecretFixtureMarker'],
  ['unreviewed application body', 'AppPrivateBodyFixtureMarker'],
  ['unreviewed native body', 'RejectedNativeBodyFixtureMarker'],
  ['unreviewed native span name', 'UnreviewedNativeSpanFixtureMarker'],
] as const;

const resource = () => ({
  attributes: [
    attribute('service.name', 'can-i-update-browser'),
    attribute('service.version', '1.2.3'),
    attribute('deployment.environment.name', 'test'),
    attribute('unreviewed.resource.key', 'ResourceSecretFixtureMarker'),
  ],
});

const scope = () => ({
  name: 'can-i-update-browser',
  version: 'ScopeSecretFixtureMarker',
  attributes: [attribute('unreviewed.scope.key', 'ScopeSecretFixtureMarker')],
});

const logRecord = (body: string): OtlpLogRecord => ({
  timeUnixNano: nanos,
  observedTimeUnixNano: nanos,
  severityNumber: 17,
  severityText: 'Error',
  body: { stringValue: body },
  traceId,
  spanId,
  attributes: [
    attribute('exception.type', 'TypeError'),
    attribute('exception.message', syntheticMessage),
    attribute('exception.stacktrace', `smokeDiagnostics.ts:42:7\n${syntheticMessage}`),
    attribute('error.source', 'browser'),
    attribute('comparison.package.name', 'minimist'),
    attribute('unreviewed.log.key', 'LogSecretFixtureMarker'),
  ],
});

const logsPayload = (records: OtlpLogRecord[]) => ({
  resourceLogs: [
    {
      resource: resource(),
      scopeLogs: [{ scope: scope(), logRecords: records }],
    },
  ],
});

const span = (name = 'briefing.submit', includeNativePayload = false): OtlpSpan => ({
  traceId,
  spanId,
  name,
  kind: 2,
  startTimeUnixNano: nanos,
  endTimeUnixNano: nanos,
  attributes: [
    attribute('exception.type', 'TypeError'),
    attribute('exception.message', syntheticMessage),
    attribute('exception.stacktrace', `smokeDiagnostics.ts:42:7\n${syntheticMessage}`),
    attribute('comparison.package.name', 'minimist'),
    attribute('unreviewed.span.key', 'SpanSecretFixtureMarker'),
  ],
  events: [
    {
      name: 'exception',
      timeUnixNano: nanos,
      attributes: [attribute('exception.message', 'NativeEventSecretFixtureMarker')],
    },
  ],
  links: includeNativePayload
    ? [
        {
          traceId,
          spanId,
          attributes: [attribute('exception.message', 'NativeLinkSecretFixtureMarker')],
        },
      ]
    : [],
  status: { code: 2, message: 'NativeStatusSecretFixtureMarker' },
});

const tracesPayload = (spans: OtlpSpan[]) => ({
  resourceSpans: [
    {
      resource: resource(),
      scopeSpans: [{ scope: scope(), spans }],
    },
  ],
});

type CollectorEndpoints = { readonly appUrl: string; readonly nativeUrl: string };

const collectorEndpoints = async (collector: CollectorProcess): Promise<CollectorEndpoints> => {
  const appPort = await collector.port(4318);
  const nativePort = await collector.port(4319);
  return { appUrl: `http://127.0.0.1:${appPort}/v1`, nativeUrl: `http://127.0.0.1:${nativePort}/v1` };
};

const sendSinkTraffic = async (collector: CollectorProcess, appUrl: string, nativeUrl: string): Promise<void> => {
  await Promise.all([waitForEndpoint(`${appUrl}/logs`, collector), waitForEndpoint(`${nativeUrl}/logs`, collector)]);

  await sendOtlp(`${appUrl}/logs`, logsPayload([logRecord('runtime.error'), logRecord('AppPrivateBodyFixtureMarker')]));
  await sendOtlp(`${appUrl}/traces`, tracesPayload([span()]));
  await sendOtlp(
    `${nativeUrl}/logs`,
    logsPayload([logRecord('runtime.error'), logRecord('RejectedNativeBodyFixtureMarker')]),
  );
  await sendOtlp(
    `${nativeUrl}/traces`,
    tracesPayload([span('briefing.submit', true), span('UnreviewedNativeSpanFixtureMarker', true)]),
  );
};

const awaitSinkOutput = async (collector: CollectorProcess): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (
    Date.now() < deadline &&
    (!collector.output().includes('briefing.submit') || !collector.output().includes('minimist'))
  ) {
    await delay(100);
  }
};

const assertSinkOutput = (output: string): void => {
  check(output.includes('runtime.error'), 'The local debug sink did not receive the approved log message.');
  check(output.includes('briefing.submit'), 'The local debug sink did not receive the approved span name.');
  check(output.includes('minimist'), 'The local debug sink dropped validated comparison context.');
  check(output.includes('smokeDiagnostics.ts:42:7'), 'The local debug sink dropped the reviewed code location.');
  for (const [field, marker] of forbiddenMarkers) {
    check(!output.includes(marker), `A synthetic ${field} value reached the local debug sink.`);
  }
};

const exerciseSink = async (dockerEnv: NodeJS.ProcessEnv): Promise<void> => {
  const name = `can-i-update-diagnostics-${process.pid}-${Date.now()}`;
  const collector = startCollector(name, dockerEnv);
  try {
    const { appUrl, nativeUrl } = await collectorEndpoints(collector);
    await sendSinkTraffic(collector, appUrl, nativeUrl);
    await awaitSinkOutput(collector);
    assertSinkOutput(collector.output());
  } finally {
    await collector.stop();
  }
};

const main = async (): Promise<void> => {
  const dockerConfig = await mkdtemp(join(tmpdir(), 'can-i-update-diagnostics-docker-'));
  const dockerEnv = {
    PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    DOCKER_CONFIG: dockerConfig,
  };
  try {
    runDocker(['image', 'inspect', '--format', '{{.Id}}', image], dockerEnv);
    validateConfigs(dockerEnv);
    await exerciseSink(dockerEnv);
    log(
      'Collector application/native privacy smoke passed; Grafana overlay validated offline with fixture credentials only.',
    );
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
};

await main();
