import { Schema } from 'effect';

import type { NuxtApp } from '#app';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';
import { decodeTelemetryHeaders } from '#shared/telemetry/telemetryConfig.defs';
import {
  createServerDiagnosticSend,
  reportServerDiagnostic,
  type ServerTelemetryBaseConfig,
} from '#shared/telemetry/telemetryDiagnostics';

/** Any non-null, non-function container object: the gate before probing nested runtime-config nodes. */
const isScopeObject = Schema.is(Schema.Struct({}));

const isScalarString = Schema.is(Schema.String);

/** The SSR app owns its runtime config; no Nitro bundle import is required to reach it. */
// oxlint-disable-next-line rules/no-unknown-parameters -- Exported runtime-config reader container; Nuxt owns the config object shape.
const telemetryFromRuntime = (runtime: unknown): ServerTelemetryBaseConfig => {
  const config: unknown = runtime;

  const nested = (path: string) =>
    path.split('.').reduce<unknown>((value, key) => {
      if (!isScopeObject(value) || !Reflect.has(value, key)) return undefined;

      const child: unknown = Reflect.get(value, key);

      return child;
    }, config);

  const endpoint = nested('otelEndpoint');

  const endpointText = isScalarString(endpoint) ? endpoint : '';

  return {
    enabled: nested('public.telemetryEnabled') === true && endpointText.trim() !== '',
    endpoint: endpointText,
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
