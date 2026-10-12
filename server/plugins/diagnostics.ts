import { Schema } from 'effect';
import { defineNitroPlugin } from 'nitropack/runtime';

import { createServerDiagnosticSend, reportServerDiagnostic } from '#shared/telemetry/telemetryDiagnostics';

import { readServerTelemetryConfig } from '../telemetry/runtimeConfig';

const isScalarNumber = Schema.is(Schema.Number);

const errorStatusCode = (cause: unknown): number | undefined => {
  // `in` keeps inherited accessors (e.g. HTTPError.statusCode) visible; a throwing getter propagates to the hook's catch.
  if (!(cause instanceof Error) || !('statusCode' in cause)) return undefined;
  const status: unknown = cause.statusCode;

  return isScalarNumber(status) ? status : undefined;
};

/** Nitro-owned unhandled diagnostics: rendered handler failures, provider failures and their outcomes. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, hookContext) => {
    const event = hookContext.event;

    if (event === undefined) return;

    try {
      void reportServerDiagnostic(event, {
        send: createServerDiagnosticSend(event, readServerTelemetryConfig(event)),
        body: 'runtime.error',
        source: 'nuxt',
        error,
        status: errorStatusCode(error),
      });
    } catch {
      // Diagnostic classification must not alter Nitro's own error handling.
    }
  });
});
