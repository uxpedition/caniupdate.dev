import { Context, Logger, Option, Predicate, References, Schema, Tracer } from 'effect';

import { TelemetryLogMessageSchema, TelemetrySpanNameSchema } from './telemetry.schema';
import { sanitizeApplicationAnnotations, sanitizeApplicationField, telemetryDecimal } from './telemetryFields';

/** Context-derived IDs keep logs from nested/cached Effects correlated without copying request data. */
export const telemetryLogAnnotations = (fiber: Logger.Options<unknown>['fiber']) => {
  const fields = sanitizeApplicationAnnotations(fiber.getRef(References.CurrentLogAnnotations));
  const span = Option.getOrUndefined(Context.getOption(fiber.context, Tracer.ParentSpan));

  if (span !== undefined) {
    const traceId = sanitizeApplicationField('traceId', span.traceId);
    const spanId = sanitizeApplicationField('spanId', span.spanId);

    if (traceId !== undefined) fields.traceId = traceId;

    if (spanId !== undefined) fields.spanId = spanId;

    if (Predicate.isTagged(span, 'Span') && Option.isSome(span.parent)) {
      const parentSpanId = sanitizeApplicationField('parentSpanId', span.parent.value.spanId);

      if (parentSpanId !== undefined) fields.parentSpanId = parentSpanId;
    }
  }

  return fields;
};

const isEvent = Schema.is(TelemetryLogMessageSchema);

const isSpan = Schema.is(TelemetrySpanNameSchema);

const safeJson = Logger.make<unknown, string | undefined>(({ message, date, fiber, logLevel }) => {
  const event: unknown = Array.isArray(message) ? message[0] : message;

  if (!isEvent(event)) return undefined;
  const annotations = telemetryLogAnnotations(fiber);
  const spans: Record<string, string> = {};

  for (const [name, started] of fiber.getRef(References.CurrentLogSpans)) {
    if (isSpan(name)) spans[name] = telemetryDecimal(date.getTime() - started);
  }

  return JSON.stringify({
    message: event,
    level: logLevel.toUpperCase(),
    timestamp: date.toISOString(),
    annotations,
    spans,
  });
});

const consoleLogger = Logger.withLeveledConsole(safeJson);

/** Select safe fields before serialization; neither raw causes nor arbitrary objects reach console. */
export const JsonConsoleLoggerLayer = Logger.layer([
  Logger.make((options) => {
    try {
      if (Array.isArray(options.message) && options.message.length !== 1) return;
      const event: unknown = Array.isArray(options.message) ? options.message[0] : options.message;

      if (isEvent(event)) consoleLogger.log(options);
    } catch {
      // Diagnostics must not change the application result when a console sink fails.
    }
  }),
]);
