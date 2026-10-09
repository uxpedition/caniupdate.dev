import { defineNitroPlugin } from 'nitropack/runtime';

import { createServerDiagnosticSend, reportServerDiagnostic } from '#shared/telemetry/telemetryDiagnostics';

import { readServerTelemetryConfig } from '../telemetry/runtimeConfig';

const errorStatusCode = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) return undefined;
  const status: unknown = Reflect.get(error, 'statusCode');
  return typeof status === 'number' ? status : undefined;
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
