import type { H3Event } from 'h3';
import { useRuntimeConfig } from 'nitropack/runtime';

import { decodeTelemetryHeaders } from '#shared/telemetryConfig.defs';

export interface ServerTelemetryConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly headers: Record<string, string>;
}

export const readServerTelemetryConfig = (event: H3Event): ServerTelemetryConfig => {
  const config = useRuntimeConfig(event);
  const env = event.context.cloudflare?.env;
  const endpoint = env?.NUXT_OTEL_ENDPOINT ?? config.otelEndpoint;
  const enabled =
    (env?.NUXT_PUBLIC_TELEMETRY_ENABLED === undefined
      ? config.public.telemetryEnabled === true
      : env.NUXT_PUBLIC_TELEMETRY_ENABLED === 'true') && endpoint.trim() !== '';
  return {
    enabled,
    endpoint,
    headers: decodeTelemetryHeaders(env?.NUXT_OTEL_HEADERS ?? config.otelHeaders),
  };
};
