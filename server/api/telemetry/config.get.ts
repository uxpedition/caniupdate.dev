import { defineEventHandler } from 'h3';

import { decodeTelemetryRuntimeConfig } from '#shared/telemetry/telemetryConfig.defs';

import { readServerTelemetryConfig } from '../../telemetry/runtimeConfig';

export default defineEventHandler((event) => {
  const { enabled } = readServerTelemetryConfig(event);
  const config = decodeTelemetryRuntimeConfig({ enabled });
  return Response.json(config, { headers: { 'cache-control': 'no-store' } });
});
