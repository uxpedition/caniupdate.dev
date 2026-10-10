import {
  BaseTransport,
  ErrorsInstrumentation,
  InternalLoggerLevel,
  TransportItemType,
  initializeFaro,
} from '@grafana/faro-web-sdk';
import type {
  APIEvent,
  ExceptionEvent,
  ExceptionEventExtended,
  ExceptionStackFrame,
  Faro,
  TransportItem,
} from '@grafana/faro-web-sdk';
import { Effect } from 'effect';

import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { isErrorAttributeKey, sanitizeErrorAttribute, sanitizeErrorFrame } from '#shared/telemetry/telemetryError';

export type FaroErrorOptions = { readonly source?: string; readonly fatal?: boolean };

type SafeErrorLog = { readonly attributes: Readonly<Record<string, string>> };

type FaroState = {
  active: boolean;
  errorSources: WeakMap<Error, string | undefined>;
  eventSources: WeakMap<object, string>;
  errors: WeakSet<Error>;
  faro: Faro | undefined;
  handle: FaroErrorsAdapter | undefined;
  runtime: TelemetryRuntime | undefined;
  queue: SafeErrorLog[];
};

export type FaroErrorsAdapter = {
  attachRuntime(runtime: TelemetryRuntime): void;
  /** True means handled or already deduplicated; it does not confirm downstream export. */
  captureError(error: Error, options?: FaroErrorOptions): boolean;
  stop(): void;
};

const QUEUE_LIMIT = 32;

const STATE_KEY = 'can-i-update-faro-errors';

const APP_IDENTITY = { name: 'can-i-update-browser' } as const;

type HotData = { 'can-i-update-faro-errors'?: FaroState };

type HotModule = { readonly data: HotData; dispose(callback: (data: HotData) => void): void };

const createState = (): FaroState => ({
  active: false,
  errorSources: new WeakMap(),
  eventSources: new WeakMap(),
  errors: new WeakSet(),
  faro: undefined,
  handle: undefined,
  runtime: undefined,
  queue: [],
});

const hot: HotModule | undefined = import.meta.hot;

const savedState: FaroState | undefined = hot?.data[STATE_KEY];

const state = savedState ?? createState();

hot?.dispose((data) => {
  data[STATE_KEY] = state;
});

const addErrorAttribute = (attributes: Record<string, string>, key: string, value: unknown): void => {
  if (!isErrorAttributeKey(key) || typeof value !== 'string') return;
  const sanitized = sanitizeErrorAttribute(key, value);

  if (sanitized !== undefined && sanitized.length > 0) attributes[key] = sanitized;
};

/** Exception payloads are the only API events carrying a string `value`; the transport decides by item type. */
const isExceptionEvent = (payload: APIEvent): payload is ExceptionEventExtended =>
  'value' in payload && typeof payload.value === 'string';

const safeStackFrames = (frames: ReadonlyArray<ExceptionStackFrame> | undefined): ExceptionStackFrame[] => {
  if (frames === undefined) return [];
  const safe: ExceptionStackFrame[] = [];

  for (const frame of frames.slice(0, 20)) {
    if (typeof frame.filename !== 'string' || frame.lineno === undefined || frame.colno === undefined) continue;
    const location = sanitizeErrorFrame(frame.filename, frame.lineno, frame.colno);

    if (location === undefined) continue;
    const columnSeparator = location.lastIndexOf(':');
    const lineSeparator = location.lastIndexOf(':', columnSeparator - 1);

    if (columnSeparator < 0 || lineSeparator < 0) continue;
    safe.push({
      filename: location.slice(0, lineSeparator),
      lineno: Number(location.slice(lineSeparator + 1, columnSeparator)),
      colno: Number(location.slice(columnSeparator + 1)),
      function: '',
    });
  }

  return safe;
};

const safeExceptionEvent = (event: ExceptionEventExtended): ExceptionEvent => {
  const type =
    sanitizeErrorAttribute('exception.type', typeof event.type === 'string' ? event.type : 'Error') ?? 'Error';

  const message =
    typeof event.value === 'string' ? sanitizeErrorAttribute('exception.message', event.value) : undefined;

  const stackFrames = safeStackFrames(event.stacktrace?.frames);

  const stack =
    stackFrames.length === 0
      ? undefined
      : sanitizeErrorAttribute(
          'exception.stacktrace',
          stackFrames.map(({ filename, lineno, colno }) => `${filename}:${lineno}:${colno}`).join('\n'),
        );

  const retainedFrames =
    stack === undefined
      ? []
      : safeStackFrames(
          stack.split('\n').map((frame) => {
            const columnSeparator = frame.lastIndexOf(':');
            const lineSeparator = frame.lastIndexOf(':', columnSeparator - 1);

            return {
              filename: frame.slice(0, lineSeparator),
              lineno: Number(frame.slice(lineSeparator + 1, columnSeparator)),
              colno: Number(frame.slice(columnSeparator + 1)),
              function: '',
            };
          }),
        );

  return {
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : '',
    type,
    value: message ?? '',
    ...(retainedFrames.length === 0 ? {} : { stacktrace: { frames: retainedFrames } }),
  };
};

const toSafeLog = (event: ExceptionEvent, current: FaroState): SafeErrorLog => {
  const attributes: Record<string, string> = {};
  addErrorAttribute(attributes, 'exception.type', event.type);
  addErrorAttribute(attributes, 'exception.message', event.value);

  if (event.stacktrace !== undefined) {
    const frames = safeStackFrames(event.stacktrace.frames);

    if (frames.length > 0) {
      addErrorAttribute(
        attributes,
        'exception.stacktrace',
        frames.map(({ filename, lineno, colno }) => `${filename}:${lineno}:${colno}`).join('\n'),
      );
    }
  }

  addErrorAttribute(attributes, 'error.source', current.eventSources.get(event));

  return { attributes };
};

const dispatch = (current: FaroState, log: SafeErrorLog): void => {
  if (!current.active) return;

  if (current.runtime === undefined) {
    if (current.queue.length === QUEUE_LIMIT) current.queue.shift();
    current.queue.push(log);

    return;
  }

  try {
    current.runtime.runFork(Effect.logError('runtime.error').pipe(Effect.annotateLogs(log.attributes)));
  } catch {
    // A disposed or unavailable diagnostic runtime must not recurse into error capture.
  }
};

class FaroErrorTransport extends BaseTransport {
  readonly name = 'can-i-update:faro-errors';
  readonly version = '1';

  constructor(private readonly current: FaroState) {
    super();
  }

  send(items: TransportItem | TransportItem[]): void {
    if (!this.current.active) return;

    try {
      for (const item of Array.isArray(items) ? items : [items]) {
        if (item.type !== TransportItemType.EXCEPTION || !isExceptionEvent(item.payload)) continue;

        try {
          dispatch(this.current, toSafeLog(item.payload, this.current));
        } catch {
          // Malformed Faro events are diagnostic-only and are discarded locally.
        }
      }
    } catch {
      // The transport is synchronous and never reports its own failures through Faro.
    }
  }
}

const retainedRejectionEvent = (event: ExceptionEventExtended): TransportItem | null => {
  // Faro's rejection instrumentation labels primitive promise rejections; Error rejections keep their exception name.
  const prose =
    typeof event.value === 'string' && event.value.startsWith('Non-Error promise rejection captured with value:')
      ? event.value
      : undefined;

  if (prose === undefined) return null;
  const safeEvent = safeExceptionEvent(event);
  state.eventSources.set(safeEvent, 'browser.rejection');

  return { type: TransportItemType.EXCEPTION, payload: safeEvent, meta: {} };
};

const exceptionSource = (originalError: Error | undefined): string | undefined => {
  if (originalError === undefined) return 'browser';

  if (state.errorSources.has(originalError)) return state.errorSources.get(originalError);

  return 'browser';
};

const retainedExceptionEvent = (event: ExceptionEventExtended): TransportItem | null => {
  const originalError = event.originalError instanceof Error ? event.originalError : undefined;

  if (originalError !== undefined && state.errors.has(originalError)) return null;
  const rawSource = exceptionSource(originalError);
  const safeSource = rawSource === undefined ? undefined : sanitizeErrorAttribute('error.source', rawSource);
  const safeEvent = safeExceptionEvent(event);

  if (safeSource !== undefined) state.eventSources.set(safeEvent, safeSource);

  if (originalError !== undefined) state.errors.add(originalError);

  return { type: TransportItemType.EXCEPTION, payload: safeEvent, meta: {} };
};

const beforeSend = (item: TransportItem): TransportItem | null => {
  try {
    if (!state.active || !isExceptionEvent(item.payload)) return null;

    return item.payload.type === 'UnhandledRejection'
      ? retainedRejectionEvent(item.payload)
      : retainedExceptionEvent(item.payload);
  } catch {
    return null;
  }
};

const makeHandle = (): FaroErrorsAdapter => ({
  attachRuntime(runtime) {
    if (!state.active) return;
    state.runtime = runtime;
    const queued = state.queue.splice(0);

    for (const log of queued) dispatch(state, log);
  },
  captureError(error, options = {}) {
    if (!state.active || !(error instanceof Error) || state.faro === undefined) return false;

    if (state.errors.has(error)) return true;
    const source = options.source === undefined ? undefined : sanitizeErrorAttribute('error.source', options.source);
    state.errorSources.set(error, source);

    try {
      state.faro.api.pushError(error, {
        originalError: error,
        skipDedupe: true,
        ...(typeof options.fatal === 'boolean' ? { fatal: options.fatal } : {}),
      });

      return true;
    } catch {
      // Application errors remain application errors if Faro rejects an adapter event.
      return false;
    }
  },
  stop() {
    state.active = false;
    state.runtime = undefined;
    state.queue.length = 0;
    // Faro 2.12.1 does not expose an ErrorsInstrumentation teardown hook; its listener remains inert.
  },
});

export const initializeFaroErrors = (): FaroErrorsAdapter => {
  if (state.handle !== undefined) {
    state.active = true;

    return state.handle;
  }

  state.active = true;
  const transport = new FaroErrorTransport(state);

  try {
    state.faro = initializeFaro({
      app: APP_IDENTITY,
      metas: [],
      instrumentations: [new ErrorsInstrumentation()],
      transports: [transport],
      sessionTracking: { enabled: false },
      batching: { enabled: false },
      dedupe: true,
      preserveOriginalError: true,
      preventGlobalExposure: true,
      internalLoggerLevel: InternalLoggerLevel.OFF,
      beforeSend,
    });
  } catch {
    state.active = false;
  }

  state.handle = makeHandle();

  return state.handle;
};
