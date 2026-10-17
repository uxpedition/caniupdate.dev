// The reproducible local scenario for the three-runtime launcher, run against an isolated persistence root so it
// never touches `.wrangler/state`:
//
//   node scripts/smoke/smoke.ts [--built] [--measure] [--keep]
//
// It starts the loopback fixture provider the briefing Worker's `.dev.vars` names, starts `scripts/dev/dev.ts` with its
// own ports, then drives the real browser-facing path — POST, socket `available`, a device-shaped Origin on this
// machine's own address, restart, D1 hit, reconnect — and asserts that a settled job costs no second provider call.
// `--measure` adds the Free-tier CPU sampling; `--keep` leaves the temporary persistence root in place for inspection.
//
// Nothing here deploys, calls a remote environment, or reads a credential: the provider is a loopback fixture and the
// only secrets involved are the fixture values in the git-ignored `workers/briefing/.dev.vars`.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';

import { startProviderFixture, type ProviderFixture } from '../../workers/briefing/test/provider.stub.ts';
import {
  FRONTEND_ORIGIN,
  HEALTH_TIMEOUT_MS,
  PACKAGE_NAME,
  SETTLED_FROM,
  SETTLED_TO,
  SmokeFailure,
  builtFrontendConfig,
  check,
  devVarsPath,
  log,
} from './_internals/defs.ts';
import { startLauncher, portsAreFree, waitForHealth, type Launcher } from './_internals/launcher.ts';
import { runMeasurements } from './_internals/measure.ts';
import { describeFrames, submit, submitColdPair, submitFromDevice, waitForAvailable } from './_internals/submission.ts';

const isScalarString = Schema.is(Schema.String);

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

/**
 * The restart proves two things at once: state under this root survives, and a settled job answers from D1. A settled
 * job must never cost another provider call, on the D1 hit or on the reconnect that follows it.
 */
const verifyRestart = async (
  built: boolean,
  persistTo: string,
  provider: ProviderFixture,
  eventsUrl: string,
): Promise<Launcher> => {
  const restarted = startLauncher(built, persistTo);
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
};

const runScenario = async (built: boolean, persistTo: string, provider: ProviderFixture): Promise<Launcher> => {
  log(`scenario: ${built ? 'dev (built frontend)' : 'dev (Nuxt HMR)'}, persistence root ${persistTo}`);
  const launcher = startLauncher(built, persistTo);

  try {
    await waitForHealth(launcher, HEALTH_TIMEOUT_MS);
    log(`frontend healthy on ${FRONTEND_ORIGIN}`);

    const eventsUrl = await submitColdPair(SETTLED_FROM, SETTLED_TO, provider);
    await submitFromDevice();

    await launcher.stop();
    check(await portsAreFree(), 'Shutdown must release the evidence, briefing, and frontend ports');

    return await verifyRestart(built, persistTo, provider, eventsUrl);
  } catch (error) {
    await launcher.stop();
    throw error;
  }
};

/** A `--built` run drives the built frontend, so the build output has to exist before the scenario starts. */
const assertBuiltFrontend = async (built: boolean): Promise<void> => {
  if (!built) return;
  const config = await readFile(builtFrontendConfig, 'utf8').catch(() => undefined);

  if (config === undefined) {
    throw new SmokeFailure(`Missing ${builtFrontendConfig}. Run \`nub run build\` before --built.`);
  }
};

/** Reports whatever the scenario threw: classified throwables render fully, the rest serialize as diagnostic JSON. */
const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error) return cause.stack ?? cause.message;

  return isScalarString(cause) ? cause : JSON.stringify(cause);
};

/** One fixture-backed run: temporary root, loopback provider, scenario, optional measurement, and full cleanup. */
const runOnce = async (built: boolean, measure: boolean, keep: boolean): Promise<void> => {
  const persistTo = await mkdtemp(join(tmpdir(), 'can-i-update-smoke-'));
  const port = await fixtureProviderPort();
  const provider = await startProviderFixture({ port });
  log(`fixture provider listening on 127.0.0.1:${port} (loopback, no real credential)`);
  let launcher: Launcher | undefined;
  let failure: unknown;

  try {
    launcher = await runScenario(built, persistTo, provider);
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

  if (failure !== undefined) throw failure;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const built = argv.includes('--built');
  const measure = argv.includes('--measure');
  const keep = argv.includes('--keep');
  await assertBuiltFrontend(built);

  try {
    await runOnce(built, measure, keep);
    log('scenario: DONE');
  } catch (failure) {
    log(`scenario: FAIL\n${describeFailure(failure)}`);
    process.exitCode = 1;
  }
};

await main();
