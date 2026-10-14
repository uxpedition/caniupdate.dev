import { Data, Duration, Effect, Schema } from 'effect';

import type { PackageBriefing } from '#shared/comparison/briefing/briefing.defs';
import { decodeBriefingJobEvent, type BriefingJobEvent } from '#shared/comparison/briefing/briefingJob.defs';

/** The generation states a submitted job reports before it settles. */
export type BriefingStatus = 'queued' | 'running';

/** One second, two, then four: the whole backoff one subscription may spend before it gives up. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const SUBSCRIPTION_DEADLINE = Duration.seconds(180);

/** Preserves arbitrary DOM abort reasons without exposing them through a return contract. */
const throwSubscriptionAbort = (signal: AbortSignal): never => {
  if (signal.reason !== undefined) throw signal.reason;
  const abortError = new Error('The briefing subscription was aborted');
  abortError.name = 'AbortError';

  throw abortError;
};

const isScalarString = Schema.is(Schema.String);

type CompletedBriefing = { readonly _tag: 'completed'; readonly briefing: PackageBriefing; readonly revision: number };

type SocketOutcome = { readonly _tag: 'disconnected'; readonly revision: number } | CompletedBriefing;

type SocketMessage =
  | { readonly _tag: 'ignored' }
  | { readonly _tag: 'status'; readonly status: BriefingStatus; readonly revision: number }
  | CompletedBriefing;

/** Constructors for local socket states, destructured once at module scope so each frame calls them directly. */
const { ignored, status, completed, disconnected, $is } = Data.taggedEnum<SocketMessage | SocketOutcome>();

const isIgnoredSocketMessage = $is('ignored');

const isCompletedSocketMessage = $is('completed');

/** Parses one text frame against the worker's protocol; malformed JSON or a protocol violation yields undefined. */
const decodeJobEventFrame = (data: string): BriefingJobEvent | undefined => {
  try {
    return decodeBriefingJobEvent(JSON.parse(data));
  } catch {
    return undefined;
  }
};

/** Classifies one decoded frame against the highest revision this subscription has already applied. */
const messageFromJobEvent = (frame: BriefingJobEvent, highest: number): SocketMessage => {
  if (frame.revision <= highest) return ignored();

  if (frame.status === 'available') return completed({ briefing: frame.briefing, revision: frame.revision });

  if (frame.status === 'unavailable') {
    return completed({
      briefing: { status: 'unavailable', reason: frame.reason, bullets: [], sources: [] },
      revision: frame.revision,
    });
  }

  return status({ status: frame.status, revision: frame.revision });
};

/**
 * Reads one WebSocket message against the worker's protocol and classifies it against the highest applied revision.
 * Non-text, malformed, and off-protocol frames yield undefined; the subscription fails on them.
 */
const messageFromSocketEvent = (event: MessageEvent, highest: number): SocketMessage | undefined => {
  const data: unknown = event.data;
  const frame = isScalarString(data) ? decodeJobEventFrame(data) : undefined;

  return frame === undefined ? undefined : messageFromJobEvent(frame, highest);
};

const reportBriefingStatus = (onStatus: (state: BriefingStatus) => void, state: BriefingStatus): Error | undefined => {
  try {
    onStatus(state);

    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause : new Error('The briefing status could not be updated', { cause });
  }
};

const listenForJobEvents = (
  socket: WebSocket,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.callback<SocketOutcome, Error>((resume) => {
    let highest = revision;
    let resumed = false;

    function onMessage(event: MessageEvent): void {
      const message = messageFromSocketEvent(event, highest);

      if (message === undefined) {
        complete(Effect.fail(new Error('The briefing stream sent a frame the page cannot read')));

        return;
      }

      if (isIgnoredSocketMessage(message)) return;

      highest = message.revision;

      if (isCompletedSocketMessage(message)) {
        complete(Effect.succeed(message));

        return;
      }

      const statusError = reportBriefingStatus(onStatus, message.status);

      if (statusError !== undefined) complete(Effect.fail(statusError));
    }

    function onClose(): void {
      complete(Effect.succeed(disconnected({ revision: highest })));
    }

    function detachListeners(): void {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    }

    function complete(effect: Effect.Effect<SocketOutcome, Error>): void {
      if (resumed) return;
      // Effect.callback runs its returned cleanup on interruption only; normal resumption detaches listeners here.
      resumed = true;
      detachListeners();
      resume(effect);
    }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);

    return Effect.sync(detachListeners);
  });

/** Each connection scope owns its socket and listener cleanup. */
const readJobEventSocket = (
  url: string,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WebSocket(url),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error('The briefing socket could not be opened', { cause }),
        }),
        (socket) => Effect.sync(() => socket.close()),
      );

      return yield* listenForJobEvents(socket, revision, onStatus);
    }),
  );

/**
 * Follows one job's socket to a terminal frame. Effect scopes each connection, owns reconnect sleeps, and applies one
 * deadline to the whole subscription. Reconnecting only reads the current snapshot; it never submits another job.
 */
export const waitForJobEvent = async (
  url: string,
  revision: number,
  signal: AbortSignal,
  onStatus: (state: BriefingStatus) => void,
): Promise<PackageBriefing> => {
  if (signal.aborted) throwSubscriptionAbort(signal);

  let highest = revision;

  const subscription = Effect.gen(function* () {
    let attempts = 0;

    while (true) {
      const outcome = yield* readJobEventSocket(url, highest, onStatus);
      highest = outcome.revision;

      if (isCompletedSocketMessage(outcome)) return outcome.briefing;
      const delay = RECONNECT_DELAYS_MS.at(attempts);

      if (delay === undefined)
        return yield* Effect.fail(new Error('The briefing stream closed before it reported a result'));
      attempts += 1;
      yield* Effect.sleep(Duration.millis(delay));
    }
  });

  const boundedSubscription = Effect.timeoutOrElse(subscription, {
    duration: SUBSCRIPTION_DEADLINE,
    orElse: () => Effect.fail(new Error('The briefing subscription exceeded its 180-second deadline')),
  });

  return Effect.runPromise(boundedSubscription, { signal }).catch((cause: unknown) => {
    if (!signal.aborted) throw cause;

    return throwSubscriptionAbort(signal);
  });
};
