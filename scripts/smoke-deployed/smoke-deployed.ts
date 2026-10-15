import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorizedFetch,
  checkAuthorizedSocketAdmission,
  checkUnauthenticatedFrontend,
  checkUnauthenticatedSocket,
  readSmokeConfig,
  SmokeFailure,
  type SmokeConfig,
} from './_internals/access.ts';
import { runBrowser, type BrowserOutcome } from './_internals/browserScenario.ts';
import { decodeHealthResponse } from './_internals/contracts.ts';

const OUTPUT_DIRECTORY = resolve(fileURLToPath(new URL('../..', import.meta.url)), '.data/preview-verification');

type SmokeReport = {
  outcome: 'passed' | 'failed';
  mode?: 'local' | 'preview';
  commitSha?: string;
  access?: { frontend: number; socket: number; authorizedSocketAdmission: number };
  health?: 'passed';
  browsers: BrowserOutcome[];
  failureStage?: string;
};

const report: SmokeReport = { outcome: 'failed', browsers: [] };

async function verifySurface(config: SmokeConfig): Promise<void> {
  const response = await authorizedFetch(config, '/api/health', 'health');
  const payload: unknown = await response.json();

  decodeHealthResponse(payload);

  if (response.status !== 200) throw new SmokeFailure('health');

  report.health = 'passed';
}

async function verifyAccess(config: SmokeConfig): Promise<void> {
  if (config.local) return;

  const socketUrl = new URL(`/api/briefings/${'0'.repeat(64)}/events`, config.socketOrigin).href;
  const frontend = await checkUnauthenticatedFrontend(config);
  const socket = await checkUnauthenticatedSocket(config, socketUrl);

  const authorizedSocketAdmission = await checkAuthorizedSocketAdmission(config);

  report.access = { frontend, socket, authorizedSocketAdmission };
}

async function run(): Promise<void> {
  const browser = process.env['PREVIEW_BROWSER'];

  if (browser !== undefined && browser !== 'chromium' && browser !== 'firefox') {
    throw new SmokeFailure('browser-selection');
  }

  const browsers = browser === undefined ? (['chromium', 'firefox'] as const) : ([browser] as const);
  const config = readSmokeConfig();

  report.mode = config.local ? 'local' : 'preview';
  report.commitSha = config.expectedSha;
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  await verifyAccess(config);

  await verifySurface(config);

  for (const name of browsers) {
    const outcome = await runBrowser(name, config, OUTPUT_DIRECTORY);

    report.browsers.push(outcome);

    if (outcome.outcome !== 'passed') throw new SmokeFailure(outcome.failureStage ?? 'browser');
  }

  report.outcome = 'passed';
}

try {
  await run();
} catch (cause) {
  report.failureStage = cause instanceof SmokeFailure ? cause.stage : 'configuration-or-response';
  process.exitCode = 1;
} finally {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  await writeFile(resolve(OUTPUT_DIRECTORY, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
