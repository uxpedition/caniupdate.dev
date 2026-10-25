import { Data, Duration, Effect, Schema } from 'effect';

import type { PackageBriefing } from '#shared/comparison/briefing/briefing.defs';
import { decodeBriefingJobEvent, type BriefingJobEvent } from '#shared/comparison/briefing/briefingJob.defs';

/** The generation states a submitted job reports before it settles. */
export type BriefingStatus = 'queued' | 'running';

export type SubscriptionOutcome =
  | 'queued'
  | 'running'
  | 'available'
  | 'unavailable'
  | 'failure'
  | 'cancelled'
  | 'retry';

export type SubscriptionReason =
  | 'timeout'
  | 'malformed'
  | 'transport'
  | 'disconnected'
  | 'disconnect-exhausted'
  | 'cancelled'
  | 'unexpected';

/** One observable step of a subscription. `attempt` counts reconnects; either number is absent when it is not known. */
export type SubscriptionTransition = {
  readonly outcome: SubscriptionOutcome;
  readonly reason?: SubscriptionReason;
  readonly attempt?: number;
  readonly revision?: number;
};

export type SubscriptionReporter = (transition: SubscriptionTransition) => void;

/** One second, two, then four: the whole backoff one subscription may spend before it gives up. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const SUBSCRIPTION_DEADLINE = Duration.seconds(180);

/** Best-effort: a throwing reporter cannot change subscription, reconnect, or query results. */
export const reportSubscriptionTransition = (
  report: SubscriptionReporter | undefined,
  transition: SubscriptionTransition,
): void => {
  try {
    report?.(transition);
  } catch {
    // Observing a socket transition must not alter subscription or reconnect behavior.
  }
};

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

/** Normal completion detaches immediately; interruption uses the callback's returned cleanup. */
const listenForSocketOutcome = (
  socket: WebSocket,
  receive: (event: MessageEvent, complete: (effect: Effect.Effect<SocketOutcome, Error>) => void) => void,
  closed: () => SocketOutcome,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.callback<SocketOutcome, Error>((resume) => {
    let resumed = false;

    function onMessage(event: MessageEvent): void {
      receive(event, complete);
    }

    function onClose(): void {
      complete(Effect.succeed(closed()));
    }

    function detachListeners(): void {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    }

    function complete(effect: Effect.Effect<SocketOutcome, Error>): void {
      if (resumed) return;
      resumed = true;
      detachListeners();
      resume(effect);
    }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);

    return Effect.sync(detachListeners);
  });

const listenForJobEvents = (
  socket: WebSocket,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
  onTransition?: SubscriptionReporter,
): Effect.Effect<SocketOutcome, Error> => {
  let highest = revision;

  return listenForSocketOutcome(
    socket,
    (event, complete) => {
      const message = messageFromSocketEvent(event, highest);

      if (message === undefined) {
        reportSubscriptionTransition(onTransition, { outcome: 'failure', reason: 'malformed', revision: highest });
        complete(Effect.fail(new Error('The briefing stream sent a frame the page cannot read')));

        return;
      }

      if (isIgnoredSocketMessage(message)) return;

      highest = message.revision;

      if (isCompletedSocketMessage(message)) {
        reportSubscriptionTransition(onTransition, { outcome: message.briefing.status, revision: highest });
        complete(Effect.succeed(message));

        return;
      }

      const statusError = reportBriefingStatus(onStatus, message.status);

      if (statusError !== undefined) {
        reportSubscriptionTransition(onTransition, { outcome: 'failure', reason: 'unexpected', revision: highest });
        complete(Effect.fail(statusError));
      }
    },
    () => disconnected({ revision: highest }),
  );
};

/** Each connection scope owns its socket and listener cleanup. */
const readJobEventSocket = (
  url: string,
  revision: number,
  onStatus: (state: BriefingStatus) => void,
  onTransition?: SubscriptionReporter,
): Effect.Effect<SocketOutcome, Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WebSocket(url),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error('The briefing socket could not be opened', { cause }),
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => reportSubscriptionTransition(onTransition, { outcome: 'failure', reason: 'transport' })),
          ),
        ),
        (socket) => Effect.sync(() => socket.close()),
      );

      return yield* listenForJobEvents(socket, revision, onStatus, onTransition);
    }),
  );

type SubscriptionCursor = { revision: number };

/** Reconnects carry the highest applied revision forward without submitting a new job. */
const followJobEvents = Effect.fnUntraced(function* (
  url: string,
  cursor: SubscriptionCursor,
  onStatus: (state: BriefingStatus) => void,
  onTransition: SubscriptionReporter | undefined,
): Effect.fn.Return<PackageBriefing, Error> {
  let attempts = 0;

  while (true) {
    const outcome = yield* readJobEventSocket(url, cursor.revision, onStatus, onTransition);
    cursor.revision = outcome.revision;

    if (isCompletedSocketMessage(outcome)) return outcome.briefing;
    const delay = RECONNECT_DELAYS_MS.at(attempts);

    if (delay === undefined) {
      reportSubscriptionTransition(onTransition, {
        outcome: 'failure',
        reason: 'disconnect-exhausted',
        attempt: attempts,
        revision: cursor.revision,
      });

      return yield* Effect.fail(new Error('The briefing stream closed before it reported a result'));
    }

    attempts += 1;
    reportSubscriptionTransition(onTransition, {
      outcome: 'retry',
      reason: 'disconnected',
      attempt: attempts,
      revision: cursor.revision,
    });
    yield* Effect.sleep(Duration.millis(delay));
  }
});

/**
 * Follows one job's socket to a terminal frame. Effect scopes each connection, owns reconnect sleeps, and applies one
 * deadline to the whole subscription. Reconnecting only reads the current snapshot; it never submits another job.
 */
export const waitForJobEvent = async (
  url: string,
  revision: number,
  signal: AbortSignal,
  onStatus: (state: BriefingStatus) => void,
  onTransition?: SubscriptionReporter,
): Promise<PackageBriefing> => {
  if (signal.aborted) {
    reportSubscriptionTransition(onTransition, { outcome: 'cancelled', reason: 'cancelled' });
    throwSubscriptionAbort(signal);
  }

  const cursor: SubscriptionCursor = { revision };
  const subscription = followJobEvents(url, cursor, onStatus, onTransition);

  const boundedSubscription = Effect.timeoutOrElse(subscription, {
    duration: SUBSCRIPTION_DEADLINE,
    orElse: () => {
      reportSubscriptionTransition(onTransition, { outcome: 'failure', reason: 'timeout', revision: cursor.revision });

      return Effect.fail(new Error('The briefing subscription exceeded its 180-second deadline'));
    },
  });

  return Effect.runPromise(boundedSubscription, { signal }).catch((cause: unknown) => {
    if (!signal.aborted) throw cause;

    reportSubscriptionTransition(onTransition, {
      outcome: 'cancelled',
      reason: 'cancelled',
      revision: cursor.revision,
    });

    return throwSubscriptionAbort(signal);
  });
};
