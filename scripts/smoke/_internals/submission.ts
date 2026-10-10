// How the scenario talks to a running comparison: the POST envelope, the device-shaped Origin the README's workflow
// documents, and the followup assertions that pin which address the events socket actually answered on. The metrics
// these helpers carry are the scenario's evidence, so every check names the observed output, never just a verdict.

import { networkInterfaces } from 'node:os';

import type { ProviderFixture } from '../../../workers/briefing/test/provider.stub.ts';
import {
  BRIEFING_PORT,
  FRONTEND_ORIGIN,
  FRONTEND_PORT,
  HASH_PATH,
  PACKAGE_NAME,
  REMOTE_FROM,
  REMOTE_TO,
  SUBSCRIPTION_TIMEOUT_MS,
  SmokeFailure,
  check,
  decodeSubmission,
  log,
} from './defs.ts';
import type { BriefingSubmission } from './defs.ts';
import { openSubscription, type Subscription } from './socket.ts';

/**
 * The Origin a browser on another device sends: the page loaded by this machine's own address, never loopback. The
 * scenario derives it from a real interface address, because that is what the launcher's allow-list and the submission
 * route's re-pointing both have to serve.
 */
export const remoteFrontendOrigin = (): string => {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') return `http://${address.address}:${FRONTEND_PORT}`;
    }
  }

  throw new SmokeFailure('This scenario needs one non-loopback IPv4 address to act as another device');
};

export const submit = async (
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

export const waitForAvailable = async (eventsUrl: string, origin: string = FRONTEND_ORIGIN): Promise<Subscription> => {
  const subscription = await openSubscription(eventsUrl, origin, SUBSCRIPTION_TIMEOUT_MS);
  const terminal = subscription.frames.at(-1);
  check(
    terminal?.status === 'available',
    `The subscription ended without an available briefing: ${JSON.stringify(subscription.frames)} ` +
      `(close ${subscription.close.code} ${subscription.close.reason})`,
  );

  return subscription;
};

export const describeFrames = (subscription: Subscription): string =>
  subscription.frames.map((frame) => `${frame.status}@${frame.revision}`).join(' -> ') +
  ` (close ${subscription.close.code} ${subscription.close.reason})`;

/** The cold path: POST, follow the socket to its terminal frame, and charge exactly one provider call. */
export const submitColdPair = async (from: string, to: string, provider: ProviderFixture): Promise<string> => {
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
export const submitFromDevice = async (): Promise<void> => {
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
