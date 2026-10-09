import { decodeTelemetryHeaders } from '#shared/telemetry/telemetryConfig.defs';

import {
  createTelemetryAdmission,
  handleTelemetryIngress,
  TelemetryIngressError,
  telemetryClientKey,
  type TelemetryAdmission,
  type TelemetryRequest,
} from '../api/telemetry/_internals/ingress';

interface WorkerLifetimeContext {
  waitUntil(promise: Promise<unknown>): void;
}

const telemetryUnavailable = (request: TelemetryRequest): Response => {
  void request.body?.cancel().catch(() => undefined);
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
};

type WorkerTelemetryRoute = 'logs' | 'traces' | 'invalid';

const classifyTelemetryPath = (pathname: string): WorkerTelemetryRoute | undefined => {
  if (pathname !== '/api/telemetry/v1' && !pathname.startsWith('/api/telemetry/v1/')) return undefined;
  if (pathname === '/api/telemetry/v1/logs') return 'logs';
  if (pathname === '/api/telemetry/v1/traces') return 'traces';
  return 'invalid';
};

const telemetryConfigFromEnvironment = (environment: object) => {
  const enabled =
    'NUXT_PUBLIC_TELEMETRY_ENABLED' in environment && environment.NUXT_PUBLIC_TELEMETRY_ENABLED === 'true';
  const endpoint =
    'NUXT_OTEL_ENDPOINT' in environment && typeof environment.NUXT_OTEL_ENDPOINT === 'string'
      ? environment.NUXT_OTEL_ENDPOINT
      : '';
  const headers = 'NUXT_OTEL_HEADERS' in environment ? decodeTelemetryHeaders(environment.NUXT_OTEL_HEADERS) : {};
  return { enabled: enabled && endpoint.trim() !== '', endpoint, headers };
};

const forwardTelemetrySignal = async <Environment extends object, Context extends WorkerLifetimeContext>(
  request: TelemetryRequest,
  signal: Exclude<WorkerTelemetryRoute, 'invalid'>,
  environment: Environment,
  context: Context,
  admission: TelemetryAdmission,
): Promise<Response> => {
  const config = telemetryConfigFromEnvironment(environment);
  if (!config.enabled) return telemetryUnavailable(request);

  try {
    return await handleTelemetryIngress(request, signal, {
      endpoint: config.endpoint,
      headers: config.headers,
      admission,
      clientKey: telemetryClientKey(request.headers.get('cf-connecting-ip') ?? undefined),
      waitUntil: (promise) => context.waitUntil(promise),
    });
  } catch (error) {
    if (error instanceof TelemetryIngressError) {
      return new Response(null, { status: error.statusCode, headers: { 'cache-control': 'no-store' } });
    }
    throw error;
  }
};

/** Intercept OTLP requests while their Web bodies are still streaming, before Nitro buffers them. */
export const withTelemetryIngress =
  <Input extends TelemetryRequest, Output, Environment extends object, Context extends WorkerLifetimeContext>(
    applicationFetch: (request: Input, environment: Environment, context: Context) => Promise<Output> | Output,
    admission = createTelemetryAdmission(),
  ): ((request: Input, environment: Environment, context: Context) => Promise<Response | Output>) =>
  async (request, environment, context) => {
    const route = classifyTelemetryPath(new URL(request.url).pathname);
    if (route === undefined) return applicationFetch(request, environment, context);
    if (route === 'invalid') return telemetryUnavailable(request);
    return forwardTelemetrySignal(request, route, environment, context, admission);
  };
