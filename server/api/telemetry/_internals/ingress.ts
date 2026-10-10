import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';
import type { SanitizedTelemetryPayload, TelemetryResource, TelemetrySignal } from '#shared/telemetry/telemetry.defs';

/** Web and Cloudflare requests share this streaming surface, not their full platform-specific Request types. */
export interface TelemetryRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Pick<Headers, 'get'>;
  readonly body: {
    cancel(): Promise<void>;
    getReader(): {
      read(): Promise<{ done: false; value: Uint8Array } | { done: true; value?: Uint8Array | undefined }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
}

export const TELEMETRY_MAX_BODY_BYTES = 256 * 1024;

export const TELEMETRY_BODY_READ_TIMEOUT_MS = 3_000;

const MAX_ACTIVE_REQUESTS = 8;

const MAX_CLIENT_BUCKETS = 128;

const MAX_REQUESTS_PER_CLIENT = 30;

const RATE_WINDOW_MS = 60_000;

const UPSTREAM_TIMEOUT_MS = 3_000;

const BROWSER_SERVICE_NAME = 'can-i-update-browser';

const JSON_CONTENT_TYPE = 'application/json';

const IP_ADDRESS_PATTERN = /^[0-9a-fA-F:.]{1,45}$/;

export class TelemetryIngressError extends Error {
  constructor(readonly statusCode: 400 | 403 | 404 | 405 | 408 | 413 | 415 | 429) {
    super('Telemetry request rejected');
    this.name = 'TelemetryIngressError';
  }
}

export const isSameOriginTelemetryRequest = (request: TelemetryRequest): boolean =>
  request.headers.get('origin') === new URL(request.url).origin;

export const telemetryClientKey = (address: string | undefined): string =>
  address !== undefined && IP_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : 'unknown';

export interface TelemetryAdmission {
  acquire(clientKey: string): (() => void) | undefined;
}

export const createTelemetryAdmission = (): TelemetryAdmission => {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  let active = 0;

  return {
    acquire(clientKey: string): (() => void) | undefined {
      const now = Date.now();

      for (const [key, bucket] of buckets) {
        if (now - bucket.startedAt >= RATE_WINDOW_MS) buckets.delete(key);
      }

      if (active >= MAX_ACTIVE_REQUESTS) return undefined;

      let bucket = buckets.get(clientKey);

      if (bucket === undefined) {
        if (buckets.size >= MAX_CLIENT_BUCKETS) return undefined;
        bucket = { startedAt: now, count: 0 };
        buckets.set(clientKey, bucket);
      }

      if (bucket.count >= MAX_REQUESTS_PER_CLIENT) return undefined;

      bucket.count += 1;
      active += 1;
      let released = false;

      return () => {
        if (!released) {
          active -= 1;
          released = true;
        }
      };
    },
  };
};

const validateRequestMethodAndOrigin = (request: TelemetryRequest): void => {
  if (request.method !== 'POST') throw new TelemetryIngressError(405);

  if (!isSameOriginTelemetryRequest(request)) throw new TelemetryIngressError(403);
};

const validateRequestMediaType = (request: TelemetryRequest): void => {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();

  if (contentType !== JSON_CONTENT_TYPE) throw new TelemetryIngressError(415);
  const contentEncoding = request.headers.get('content-encoding');

  if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
    throw new TelemetryIngressError(415);
  }
};

const validateDeclaredBodyLength = (request: TelemetryRequest): void => {
  const declaredLength = request.headers.get('content-length');

  if (declaredLength === null) return;

  if (!/^\d+$/.test(declaredLength)) throw new TelemetryIngressError(400);
  const length = Number(declaredLength);

  if (!Number.isSafeInteger(length)) throw new TelemetryIngressError(400);

  if (length > TELEMETRY_MAX_BODY_BYTES) throw new TelemetryIngressError(413);
};

const validateTelemetryRequest = (request: TelemetryRequest): void => {
  validateRequestMethodAndOrigin(request);
  validateRequestMediaType(request);
  validateDeclaredBodyLength(request);
};

const validateAndCancelOnFailure = (request: TelemetryRequest): void => {
  try {
    validateTelemetryRequest(request);
  } catch (error) {
    void request.body?.cancel().catch(() => undefined);
    throw error;
  }
};

type TelemetryBodyReader = ReturnType<NonNullable<TelemetryRequest['body']>['getReader']>;

type TelemetryBodyChunks = { readonly chunks: Uint8Array[]; readonly totalBytes: number };

const collectBoundedTelemetryChunks = async (reader: TelemetryBodyReader): Promise<TelemetryBodyChunks> => {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;

    if (totalBytes > TELEMETRY_MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new TelemetryIngressError(413);
    }

    chunks.push(chunk.value);
  }

  return { chunks, totalBytes };
};

const readTelemetryChunksWithinDeadline = async (reader: TelemetryBodyReader): Promise<TelemetryBodyChunks> => {
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, TELEMETRY_BODY_READ_TIMEOUT_MS);

  try {
    const body = await collectBoundedTelemetryChunks(reader);

    if (timedOut) throw new TelemetryIngressError(408);

    return body;
  } catch (error) {
    if (!(error instanceof TelemetryIngressError)) throw new TelemetryIngressError(400);
    throw error;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
};

// oxlint-disable-next-line rules/no-unknown-returns -- Parse step before the signal decode: JSON yields unknown by nature, and the only production consumer decodes it immediately.
export const readBoundedTelemetryBody = async (request: TelemetryRequest): Promise<unknown> => {
  validateAndCancelOnFailure(request);

  if (request.body === null) throw new TelemetryIngressError(400);

  const { chunks, totalBytes } = await readTelemetryChunksWithinDeadline(request.body.getReader());

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    throw new TelemetryIngressError(400);
  }
};

const BROWSER_SERVICE_ATTRIBUTE: TelemetryResource['attributes'][number] = {
  key: 'service.name',
  value: { stringValue: BROWSER_SERVICE_NAME },
};

const forceBrowserResource = (resource: TelemetryResource): TelemetryResource => ({
  attributes: [BROWSER_SERVICE_ATTRIBUTE],
  droppedAttributesCount: Math.min(
    65_535,
    resource.droppedAttributesCount +
      resource.attributes.length -
      Number(resource.attributes.some((attribute) => attribute.key === 'service.name')),
  ),
});

const forceBrowserIdentity = (
  signal: TelemetrySignal,
  payload: SanitizedTelemetryPayload,
): SanitizedTelemetryPayload => {
  if (signal === 'logs' && 'resourceLogs' in payload) {
    return {
      ...payload,
      resourceLogs: payload.resourceLogs.map((group) => ({
        ...group,
        resource: forceBrowserResource(group.resource),
        scopeLogs: group.scopeLogs.map((scopeLog) => ({ ...scopeLog, scope: { name: BROWSER_SERVICE_NAME } })),
      })),
    };
  }

  if (signal === 'traces' && 'resourceSpans' in payload) {
    return {
      ...payload,
      resourceSpans: payload.resourceSpans.map((group) => ({
        ...group,
        resource: forceBrowserResource(group.resource),
        scopeSpans: group.scopeSpans.map((scopeSpan) => ({ ...scopeSpan, scope: { name: BROWSER_SERVICE_NAME } })),
      })),
    };
  }

  throw new TelemetryIngressError(400);
};

export interface TelemetryIngressOptions {
  readonly endpoint: string;
  readonly headers?: Record<string, string>;
  readonly admission: TelemetryAdmission;
  readonly clientKey: string;
  readonly waitUntil: (promise: Promise<void>) => void;
  readonly fetcher?: typeof fetch;
}

const readBrowserTelemetryPayload = async (
  request: TelemetryRequest,
  signal: TelemetrySignal,
  release: () => void,
): Promise<SanitizedTelemetryPayload> => {
  try {
    const body = await readBoundedTelemetryBody(request);

    return forceBrowserIdentity(signal, decodeTelemetryPayload(signal)(body));
  } catch (error) {
    release();

    if (error instanceof TelemetryIngressError) throw error;
    throw new TelemetryIngressError(400);
  }
};

export const handleTelemetryIngress = async (
  request: TelemetryRequest,
  signalValue: string,
  options: TelemetryIngressOptions,
): Promise<Response> => {
  const signal: TelemetrySignal | undefined =
    signalValue === 'logs' || signalValue === 'traces' ? signalValue : undefined;

  if (signal === undefined) throw new TelemetryIngressError(404);

  if (options.endpoint.trim() === '') throw new TelemetryIngressError(404);
  validateAndCancelOnFailure(request);

  const release = options.admission.acquire(options.clientKey);

  if (release === undefined) {
    void request.body?.cancel().catch(() => undefined);
    throw new TelemetryIngressError(429);
  }

  const payload = await readBrowserTelemetryPayload(request, signal, release);
  const forwarding = forwardTelemetry(signal, payload, options).finally(release);
  options.waitUntil(forwarding);

  return Response.json({}, { status: 200, headers: { 'cache-control': 'no-store' } });
};

const forwardTelemetry = async (
  signal: TelemetrySignal,
  payload: SanitizedTelemetryPayload,
  options: {
    readonly endpoint: string;
    readonly headers?: Record<string, string>;
    readonly fetcher?: typeof fetch;
  },
): Promise<void> => {
  try {
    const endpoint = new URL(options.endpoint);

    if (
      (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      endpoint.search !== '' ||
      endpoint.hash !== ''
    ) {
      return;
    }

    const basePath = endpoint.pathname.replace(/\/+$/, '');
    endpoint.pathname = `${basePath}/v1/${signal}`;
    const headers = new Headers(options.headers);
    headers.set('content-type', JSON_CONTENT_TYPE);

    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // Workers reject `error`; `manual` still prevents forwarding credentials or records through a redirect.
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    await response.body?.cancel().catch(() => undefined);
  } catch {
    // Collector errors and provider response content never cross the browser ingress boundary.
  }
};
