import { setTimeout as delay } from 'node:timers/promises';

import { Predicate } from 'effect';
import type { Page, Response as BrowserResponse } from 'playwright';

import { SmokeFailure, type SmokeConfig } from './access.ts';
import { decodeBriefingJobEvent, decodeBriefingSubmission, type BriefingSubmission } from './contracts.ts';

const PACKAGE_NAME = 'is-number';

const FROM_VERSION = '6.0.0';

const TO_VERSION = '7.0.0';

type SocketSnapshot = { status: string; revision: number; frames: number; reason?: string };

export type GenerationOutcome = {
  submission: string;
  outcome: 'cached-available' | 'socket-completed';
  frames: number;
};

export class BriefingObserver {
  private readonly snapshots = new Map<string, SocketSnapshot>();

  private decodeFailures = 0;

  private transportFailure: string | undefined;

  constructor(page: Page) {
    page.on('websocket', (socket) => {
      socket.on('socketerror', (message) => {
        const status = /(?:response[^0-9]*)([0-9]{3})/i.exec(message)?.[1];

        this.transportFailure = status ?? 'unknown';
      });
      socket.on('framereceived', ({ payload }) => {
        try {
          const text = Predicate.isString(payload) ? payload : payload.toString('utf8');
          const frame = decodeBriefingJobEvent(JSON.parse(text));
          const frames = (this.snapshots.get(socket.url())?.frames ?? 0) + 1;

          const snapshot: SocketSnapshot = { status: frame.status, revision: frame.revision, frames };

          if (frame.status === 'unavailable') snapshot.reason = frame.reason;

          this.snapshots.set(socket.url(), snapshot);
        } catch {
          this.decodeFailures += 1;
        }
      });
    });
  }

  private assertHealthy(snapshot: SocketSnapshot | undefined): void {
    if (this.transportFailure) throw new SmokeFailure(`briefing-socket-transport-${this.transportFailure}`);

    if (this.decodeFailures) throw new SmokeFailure('briefing-frame-decode');

    if (snapshot?.status === 'unavailable') throw new SmokeFailure(`briefing-unavailable-${snapshot.reason}`);
  }

  async settle(submission: BriefingSubmission, config: SmokeConfig): Promise<GenerationOutcome> {
    if (submission.status === 'available') return { submission: 'available', outcome: 'cached-available', frames: 0 };

    const target = new URL(submission.eventsUrl);

    if (
      target.origin !== config.socketOrigin.origin ||
      target.pathname !== `/api/briefings/${submission.hash}/events`
    ) {
      throw new SmokeFailure('briefing-socket-identity');
    }

    const deadline = Date.now() + 180_000;

    while (Date.now() < deadline) {
      const snapshot = this.snapshots.get(target.href);

      this.assertHealthy(snapshot);

      if (snapshot?.status === 'available' && snapshot.revision > submission.revision) {
        return { submission: submission.status, outcome: 'socket-completed', frames: snapshot.frames };
      }

      await delay(100);
    }

    throw new SmokeFailure('briefing-socket-timeout');
  }
}

export async function decodeSubmission(response: BrowserResponse): Promise<BriefingSubmission> {
  const payload: unknown = await response.json();
  const submission = decodeBriefingSubmission(payload);
  const expectedStatus = submission.status === 'available' ? 200 : 202;

  if (
    response.status() !== expectedStatus ||
    submission.packageName !== PACKAGE_NAME ||
    submission.from !== FROM_VERSION ||
    submission.to !== TO_VERSION
  )
    throw new SmokeFailure('briefing-submission');

  return submission;
}

/** Matches a browser briefing submission to this scenario's comparison endpoint. */
export function isBriefingSubmission(config: SmokeConfig, method: string, url: string): boolean {
  if (method !== 'POST') return false;

  const parsed = new URL(url);

  return (
    parsed.origin === config.frontendOrigin.origin &&
    parsed.pathname === `/api/package/${PACKAGE_NAME}/compare/briefing`
  );
}

export function nextSubmission(page: Page, config: SmokeConfig): Promise<BrowserResponse> {
  return page.waitForResponse((response) => isBriefingSubmission(config, response.request().method(), response.url()), {
    timeout: 30_000,
  });
}
