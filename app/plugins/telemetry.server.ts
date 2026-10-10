import { Schema } from 'effect';
import type { RuntimeConfig } from 'nuxt/schema';

import type { NuxtApp } from '#app';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { decodeTelemetryHeaders } from '#shared/telemetry/telemetryConfig.defs';
import {
  createServerDiagnosticSend,
  reportServerDiagnostic,
  type ServerTelemetryBaseConfig,
} from '#shared/telemetry/telemetryDiagnostics';

const isScalarString = Schema.is(Schema.String);

/** The SSR app owns its runtime config; no Nitro bundle import is required to reach it. */
const telemetryFromRuntime = (runtime: RuntimeConfig): ServerTelemetryBaseConfig => {
  // Nuxt types the members, but environment overrides can change their runtime value, so each is checked here.
  const endpointText = isScalarString(runtime.otelEndpoint) ? runtime.otelEndpoint : '';

  return {
    enabled: runtime.public.telemetryEnabled === true && endpointText.trim() !== '',
    endpoint: endpointText,
    headers: decodeTelemetryHeaders(runtime.otelHeaders),
  };
};

const telemetryFromNuxtApp = (): ServerTelemetryBaseConfig => {
  try {
    return telemetryFromRuntime(useRuntimeConfig());
  } catch {
    return { enabled: false, endpoint: '', headers: {} };
  }
};

const reportServerFailure = (nuxtApp: NuxtApp, source: string, cause: unknown): void => {
  const event = nuxtApp.ssrContext?.event;

  if (event === undefined) return;

  try {
    void reportServerDiagnostic(event, {
      send: createServerDiagnosticSend(event, telemetryFromNuxtApp()),
      body: 'runtime.error',
      source,
      error: cause,
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
