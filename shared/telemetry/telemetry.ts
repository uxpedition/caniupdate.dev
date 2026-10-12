import { Duration, Effect, Layer, Logger, ManagedRuntime, Schema, Tracer } from 'effect';
import { FetchHttpClient, HttpBody } from 'effect/http';
import { OtlpExporter, OtlpLogger, OtlpSerialization, OtlpTracer } from 'effect/observability';

import { JsonConsoleLoggerLayer } from './logging';
import { decodeTelemetryPayload } from './telemetry.defs';
import { TelemetryLogMessageSchema, TelemetryServiceNameSchema, TelemetrySpanNameSchema } from './telemetry.schema';
import { sanitizeTelemetryLogs, sanitizeTelemetryTraces } from './telemetrySanitization';

export type TelemetryRuntimeOptions = {
  /** Base URL; the runtime appends `/v1/logs` and `/v1/traces`. */
  readonly endpoint?: string;
  /** Reviewed application resource identity; unapproved values remain console-only. */
  readonly serviceName: string;
  readonly environment?: string;
  readonly serviceVersion?: string;
  /** Private OTLP headers; never copied into telemetry attributes. */
  readonly headers?: Record<string, string>;
};

export type TelemetryServices = OtlpExporter.Flusher;

export type TelemetryRuntime = ManagedRuntime.ManagedRuntime<TelemetryServices, never>;

export type TelemetryWaitUntil = (promise: Promise<unknown>) => void;

type TelemetryResourceOptions = {
  serviceName: string;
  serviceVersion?: string;
  attributes?: { 'deployment.environment.name': string };
};

/** Mutable mirror of the console-only subset of TelemetryRuntimeOptions; built key-by-key so absent keys stay absent. */
type MutableFallbackRuntimeOptions = {
  serviceName: string;
  environment?: string;
  serviceVersion?: string;
};

const EXPORT_BATCH_SIZE = 64;

const EXPORT_SHUTDOWN_TIMEOUT = Duration.millis(250);

const DISPOSE_TIMEOUT = Duration.seconds(1);

const safeResourceOptions = (options: TelemetryRuntimeOptions): TelemetryResourceOptions => {
  const environment = ['local', 'development', 'test', 'preview', 'production'].includes(options.environment ?? '')
    ? options.environment
    : undefined;

  const serviceVersion =
    options.serviceVersion !== undefined &&
    options.serviceVersion.length <= 64 &&
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?$/.test(options.serviceVersion)
      ? options.serviceVersion
      : undefined;

  const resource: TelemetryResourceOptions = { serviceName: options.serviceName };

  // Optional keys are omitted, not set to undefined: exactOptionalPropertyTypes and key-presence checks depend on it.
  if (serviceVersion !== undefined) resource.serviceVersion = serviceVersion;

  if (environment !== undefined) resource.attributes = { 'deployment.environment.name': environment };

  return resource;
};

const isApprovedLogMessage = Schema.is(TelemetryLogMessageSchema);

const isApprovedSpanName = Schema.is(TelemetrySpanNameSchema);

const filterNativeLogger = (logger: Logger.Logger<unknown, void>): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    const message = options.message;

    if (Array.isArray(message)) {
      if (message.length !== 1 || !isApprovedLogMessage(message[0])) return;
    } else if (!isApprovedLogMessage(message)) {
      return;
    }

    logger.log(options);
  });

const filterNativeTracer = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    context: tracer.context,
    span(options) {
      const approved = isApprovedSpanName(options.name);
      const span = tracer.span(approved ? options : { ...options, sampled: false });

      if (approved || !options.sampled) return span;

      return {
        _tag: span._tag,
        name: span.name,
        get spanId() {
          return span.spanId;
        },
        get traceId() {
          return span.traceId;
        },
        get parent() {
          return span.parent;
        },
        get annotations() {
          return span.annotations;
        },
        get status() {
          return span.status;
        },
        get attributes() {
          return span.attributes;
        },
        get links() {
          return span.links;
        },
        sampled: options.sampled,
        kind: span.kind,
        end: (endTime, exit) => span.end(endTime, exit),
        attribute: (key, value) => span.attribute(key, value),
        event: (name, startTime, attributes) => span.event(name, startTime, attributes),
        addLinks: (links) => span.addLinks(links),
      };
    },
  });

const sanitizedSerializationLayer = Layer.succeed(OtlpSerialization.OtlpSerialization, {
  traces: (data) => HttpBody.jsonUnsafe(decodeTelemetryPayload('traces')(sanitizeTelemetryTraces(data))),
  logs: (data) => HttpBody.jsonUnsafe(decodeTelemetryPayload('logs')(sanitizeTelemetryLogs(data))),
  metrics: (data) => HttpBody.jsonUnsafe(data),
});

const createLoggerLayer = (endpoint: string, options: TelemetryRuntimeOptions, resource: TelemetryResourceOptions) =>
  Logger.layer(
    [
      OtlpLogger.make({
        url: `${endpoint}/v1/logs`,
        resource,
        headers: options.headers,
        maxBatchSize: EXPORT_BATCH_SIZE,
        exportInterval: Duration.seconds(1),
        shutdownTimeout: EXPORT_SHUTDOWN_TIMEOUT,
      }).pipe(Effect.map(filterNativeLogger)),
    ],
    { mergeWithExisting: true },
  ).pipe(Layer.provideMerge(OtlpExporter.layerFlusher), Layer.provideMerge(JsonConsoleLoggerLayer));

const createTracerLayer = (endpoint: string, options: TelemetryRuntimeOptions, resource: TelemetryResourceOptions) =>
  Layer.effect(
    Tracer.Tracer,
    OtlpTracer.make({
      url: `${endpoint}/v1/traces`,
      resource,
      headers: options.headers,
      maxBatchSize: EXPORT_BATCH_SIZE,
      exportInterval: Duration.seconds(1),
      shutdownTimeout: EXPORT_SHUTDOWN_TIMEOUT,
    }).pipe(Effect.map(filterNativeTracer)),
  ).pipe(Layer.provideMerge(OtlpExporter.layerFlusher));

const createLayer = (options: TelemetryRuntimeOptions): Layer.Layer<TelemetryServices> => {
  const endpoint = options.endpoint?.trim().replace(/\/+$/, '');
  const baseLayer = Layer.mergeAll(JsonConsoleLoggerLayer, OtlpExporter.layerFlusher);

  if (endpoint === undefined || endpoint.length === 0 || !Schema.is(TelemetryServiceNameSchema)(options.serviceName)) {
    return baseLayer;
  }

  const resource = safeResourceOptions(options);

  return Layer.mergeAll(
    createLoggerLayer(endpoint, options, resource),
    createTracerLayer(endpoint, options, resource),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        FetchHttpClient.layer,
        Layer.succeed(FetchHttpClient.Fetch, globalThis.fetch),
        sanitizedSerializationLayer,
      ),
    ),
  );
};

/** One ManagedRuntime owns the console logger and (when configured) sanitized OTLP logs and traces. */
export const createTelemetryRuntime = (options: TelemetryRuntimeOptions): TelemetryRuntime =>
  ManagedRuntime.make(createLayer(options));

const scheduleDisposal = (runtime: TelemetryRuntime, waitUntil: TelemetryWaitUntil | undefined): Promise<void> => {
  const disposal = Effect.runPromise(Effect.timeoutOption(runtime.disposeEffect, DISPOSE_TIMEOUT)).then(
    () => undefined,
    () => undefined,
  );

  if (waitUntil === undefined) return disposal;

  try {
    waitUntil(disposal);
  } catch {
    // Runtime shutdown is diagnostic-only. The bounded promise still settles if the lifecycle hook refuses it.
  }

  return Promise.resolve();
};

/** Run the original Effect unchanged; a bounded telemetry scope closes after it has ended. */
export const runWithTelemetry = async <A, E, R extends TelemetryServices>(
  program: Effect.Effect<A, E, R>,
  options: TelemetryRuntimeOptions,
  waitUntil?: TelemetryWaitUntil,
): Promise<A> => {
  let runtime = createTelemetryRuntime(options);

  try {
    try {
      await runtime.context();
    } catch {
      try {
        console.warn('Telemetry runtime failed to initialize; continuing with console logging');
      } catch {
        // A diagnostic sink failure cannot prevent the console-only application runtime from starting.
      }

      await scheduleDisposal(runtime, waitUntil);

      const fallbackOptions: MutableFallbackRuntimeOptions = { serviceName: options.serviceName };

      if (options.environment !== undefined) fallbackOptions.environment = options.environment;

      if (options.serviceVersion !== undefined) fallbackOptions.serviceVersion = options.serviceVersion;

      runtime = createTelemetryRuntime(fallbackOptions);
      await runtime.context();
    }

    return await runtime.runPromise(program);
  } finally {
    const disposal = scheduleDisposal(runtime, waitUntil);

    if (waitUntil === undefined) await disposal;
  }
};
