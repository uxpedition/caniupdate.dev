import type { NuxtApp } from '#app';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { decodeTelemetryHeaders } from '#shared/telemetry/telemetryConfig.defs';
import {
  createServerDiagnosticSend,
  reportServerDiagnostic,
  type ServerTelemetryBaseConfig,
} from '#shared/telemetry/telemetryDiagnostics';

/** The SSR app owns its runtime config; no Nitro bundle import is required to reach it. */
const telemetryFromRuntime = (runtime: unknown): ServerTelemetryBaseConfig => {
  const config: unknown = runtime;
  const nested = (path: string, fallback?: unknown): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          typeof value === 'object' && value !== null && Reflect.has(value, key) ? Reflect.get(value, key) : fallback,
        config,
      );
  const endpoint = nested('otelEndpoint');
  return {
    enabled: nested('public.telemetryEnabled') === true && typeof endpoint === 'string' && endpoint.trim() !== '',
    endpoint: typeof endpoint === 'string' ? endpoint : '',
    headers: decodeTelemetryHeaders(nested('otelHeaders')),
  };
};

const telemetryFromNuxtApp = (): ServerTelemetryBaseConfig => {
  try {
    return telemetryFromRuntime(useRuntimeConfig());
  } catch {
    return { enabled: false, endpoint: '', headers: {} };
  }
};

const reportServerFailure = (nuxtApp: NuxtApp, source: string, error: unknown): void => {
  const event = nuxtApp.ssrContext?.event;
  if (event === undefined) return;
  try {
    void reportServerDiagnostic(event, {
      send: createServerDiagnosticSend(event, telemetryFromNuxtApp()),
      body: 'runtime.error',
      source,
      error,
    });
  } catch {
    // Diagnostic reporting must not alter SSR or rendered error recovery.
  }
};

/** SSR-rendered Vue and app errors share the Nitro request scope and its privacy policy. */
export default defineNuxtPlugin({
  enforce: 'pre',
  setup: (nuxtApp: NuxtApp): void => {
    nuxtApp.hook('vue:error', (error) => reportServerFailure(nuxtApp, 'nuxt.vue', error));
    nuxtApp.hook('app:error', (error) => reportServerFailure(nuxtApp, 'nuxt.ssr', error));
  },
});
