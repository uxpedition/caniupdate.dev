import { createError, defineEventHandler, getRouterParam, type H3Event } from 'h3';

import { telemetryWaitUntil } from '#shared/telemetry/telemetryContext';

import { telemetryClientAddress, toTelemetryRequest } from '../../../telemetry/h3Event';
import { readServerTelemetryConfig } from '../../../telemetry/runtimeConfig';
import {
  createTelemetryAdmission,
  handleTelemetryIngress,
  TelemetryIngressError,
  telemetryClientKey,
} from '../_internals/ingress';

const telemetryAdmission = createTelemetryAdmission();

const handleTelemetryRequest = async (event: H3Event): Promise<Response> => {
  try {
    const request = toTelemetryRequest(event);
    const config = readServerTelemetryConfig(event);
    if (!config.enabled) {
      void request.body?.cancel().catch(() => undefined);
      throw createError({ statusCode: 404, statusMessage: 'Telemetry unavailable' });
    }

    return await handleTelemetryIngress(request, getRouterParam(event, 'signal') ?? '', {
      endpoint: config.endpoint,
      headers: config.headers,
      admission: telemetryAdmission,
      clientKey: telemetryClientKey(telemetryClientAddress(event, request)),
      waitUntil: telemetryWaitUntil(event.context) ?? ((promise) => void promise),
    });
  } catch (error) {
    if (error instanceof TelemetryIngressError) {
      throw createError({ statusCode: error.statusCode, statusMessage: 'Telemetry request rejected' });
    }
    throw error;
  }
};

export default defineEventHandler((event) => handleTelemetryRequest(event));
