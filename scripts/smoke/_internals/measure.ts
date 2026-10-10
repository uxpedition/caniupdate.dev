// The `--measure` CPU sampling: each window reads the whole process tree table before and after a workload, so the
// difference is the CPU that workload cost, and zero-request windows report a per-second background baseline instead
// of folding it into a request that never happened.

import { setTimeout as delay } from 'node:timers/promises';

import type { ProviderFixture } from '../../../workers/briefing/test/provider.stub.ts';
import { readTrees, type RuntimePids } from './cpu.ts';
import {
  COLD_FROM,
  COLD_TO,
  FRONTEND_ORIGIN,
  LARGE_FROM,
  LARGE_PACKAGE_NAME,
  LARGE_TO,
  PACKAGE_NAME,
  SETTLED_FROM,
  SETTLED_TO,
  SUBSCRIPTION_TIMEOUT_MS,
  check,
  log,
} from './defs.ts';
import { type Launcher } from './launcher.ts';
import { openSubscription } from './socket.ts';
import { submit, submitColdPair, waitForAvailable } from './submission.ts';

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

const runtimePids = (launcher: Launcher): RuntimePids => {
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

  return pids;
};

const sampleConcurrentSubscribers = async (pids: RuntimePids, eventsUrl: string): Promise<void> => {
  const subscriberCount = 8;
  await sample('concurrent settled subscribers', pids, subscriberCount, async () => {
    const subscriptions = await Promise.all(
      Array.from({ length: subscriberCount }, () =>
        openSubscription(eventsUrl, FRONTEND_ORIGIN, SUBSCRIPTION_TIMEOUT_MS),
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
};

// The frontend carries the whole bounded packet on every submission, so a larger package is the CPU-relevant case.
const sampleLargePackageWarmups = async (pids: RuntimePids, warmPosts: number): Promise<void> => {
  const large = await submit(LARGE_FROM, LARGE_TO, LARGE_PACKAGE_NAME);
  check(large.status === 202 || large.status === 200, `Large-package POST answered ${large.status}`);

  if (large.status === 202 && large.body.eventsUrl !== undefined) await waitForAvailable(large.body.eventsUrl);
  await sample(`${LARGE_PACKAGE_NAME} warm POST (D1 hit) x${warmPosts}`, pids, warmPosts, async () => {
    await warmBurst(warmPosts, LARGE_FROM, LARGE_TO, LARGE_PACKAGE_NAME);
  });
};

export const runMeasurements = async (launcher: Launcher, provider: ProviderFixture): Promise<void> => {
  const pids = runtimePids(launcher);
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

  await sampleConcurrentSubscribers(pids, coldEventsUrl);
  await sampleLargePackageWarmups(pids, warmPosts);
};
