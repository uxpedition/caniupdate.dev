import { TelemetryIngressError } from '../api/telemetry/_internals/ingress';

interface LegacyNodeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly originalUrl?: string;
  readonly socket?: unknown;
  on(event: string, listener: (...values: unknown[]) => void): unknown;
  pause(): unknown;
  resume(): unknown;
  destroy(): unknown;
}

const isLegacyNodeRequest = (value: unknown): value is LegacyNodeRequest =>
  typeof value === 'object' &&
  value !== null &&
  'on' in value &&
  typeof value.on === 'function' &&
  'pause' in value &&
  typeof value.pause === 'function' &&
  'resume' in value &&
  typeof value.resume === 'function' &&
  'destroy' in value &&
  typeof value.destroy === 'function';

interface LegacyNodeResponse {
  readonly writableFinished: boolean;
  once(event: 'finish' | 'close', listener: () => void): unknown;
}

const isLegacyNodeResponse = (value: unknown): value is LegacyNodeResponse =>
  typeof value === 'object' &&
  value !== null &&
  'writableFinished' in value &&
  typeof value.writableFinished === 'boolean' &&
  'once' in value &&
  typeof value.once === 'function';

const nodeResponseFromEvent = (event: object): LegacyNodeResponse | undefined => {
  const node = 'node' in event ? event.node : undefined;
  if (typeof node !== 'object' || node === null || !('res' in node)) return undefined;
  return isLegacyNodeResponse(node.res) ? node.res : undefined;
};

const legacyHeaders = (value: unknown): Headers => {
  if (!(value instanceof Headers)) throw new TelemetryIngressError(400);
  return value;
};

const textEncoder = new TextEncoder();

type NodeRequestBodyState = { active: boolean };

const enqueueNodeRequestChunk = (
  request: LegacyNodeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: NodeRequestBodyState,
  chunk: unknown,
): void => {
  if (!state.active) return;
  request.pause();
  if (typeof chunk === 'string') {
    controller.enqueue(textEncoder.encode(chunk));
  } else if (chunk instanceof Uint8Array) {
    controller.enqueue(chunk);
  } else {
    state.active = false;
    controller.error(new TypeError('Invalid request body chunk'));
    request.destroy();
  }
};

const closeNodeRequestBody = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: NodeRequestBodyState,
): void => {
  if (!state.active) return;
  state.active = false;
  controller.close();
};

const failNodeRequestBody = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: NodeRequestBodyState,
  error: unknown,
): void => {
  if (!state.active) return;
  state.active = false;
  controller.error(error instanceof Error ? error : new Error('Request body stream failed'));
};

const startNodeRequestBody = (
  request: LegacyNodeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: NodeRequestBodyState,
): void => {
  request.pause();
  request.on('data', (chunk: unknown) => enqueueNodeRequestChunk(request, controller, state, chunk));
  request.on('end', () => closeNodeRequestBody(controller, state));
  request.on('error', (error: unknown) => failNodeRequestBody(controller, state, error));
};

const cancelNodeRequestBody = (
  request: LegacyNodeRequest,
  response: LegacyNodeResponse | undefined,
  state: NodeRequestBodyState,
): void => {
  state.active = false;
  request.pause();
  if (response === undefined || response.writableFinished) {
    request.destroy();
    return;
  }
  // Destroying the incoming request first aborts Nitro's error response (and can stall its dev proxy).
  const destroy = () => {
    request.destroy();
  };
  response.once('finish', destroy);
  response.once('close', destroy);
};

const nodeRequestBody = (request: LegacyNodeRequest, response?: LegacyNodeResponse): ReadableStream<Uint8Array> => {
  const state: NodeRequestBodyState = { active: true };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      startNodeRequestBody(request, controller, state);
    },
    pull() {
      if (state.active) request.resume();
    },
    cancel() {
      cancelNodeRequestBody(request, response, state);
    },
  });
};

const requestFromContainer = (value: unknown): Request | undefined => {
  if (typeof value !== 'object' || value === null || !('request' in value)) return undefined;
  const request = value.request;
  return request instanceof Request ? request : undefined;
};

const webRequestFromEvent = (event: object): Request | undefined => {
  if (!('web' in event)) return undefined;
  return requestFromContainer(event.web);
};

const cloudflareRequestFromEvent = (event: object): Request | undefined => {
  if (!('context' in event)) return undefined;
  const context = event.context;
  if (typeof context !== 'object' || context === null || !('cloudflare' in context)) return undefined;
  return requestFromContainer(context.cloudflare);
};

const requestFromEvent = (event: object): Request | undefined => {
  const webRequest = webRequestFromEvent(event);
  if (webRequest !== undefined) return webRequest;
  const cloudflareRequest = cloudflareRequestFromEvent(event);
  if (cloudflareRequest !== undefined) return cloudflareRequest;
  const eventRequest = 'req' in event ? event.req : undefined;
  return eventRequest instanceof Request ? eventRequest : undefined;
};

const nodeRequestFromEvent = (event: object): LegacyNodeRequest | undefined => {
  const eventRequest = 'req' in event ? event.req : undefined;
  if (isLegacyNodeRequest(eventRequest)) return eventRequest;

  const node = 'node' in event ? event.node : undefined;
  if (typeof node !== 'object' || node === null || !('req' in node)) return undefined;
  return isLegacyNodeRequest(node.req) ? node.req : undefined;
};

const nodeRequestURL = (headers: Headers, request: LegacyNodeRequest, path: string): URL => {
  const host = headers.get('host') ?? 'localhost';
  const forwardedProtocol = headers.get('x-forwarded-proto')?.trim().toLowerCase();
  const socket = request.socket;
  const encrypted = typeof socket === 'object' && socket !== null && 'encrypted' in socket && socket.encrypted === true;
  const protocol = forwardedProtocol === 'https' || encrypted ? 'https' : 'http';
  try {
    return new URL(path.replace(/^[/\\]+/, '/'), `${protocol}://${host}`);
  } catch {
    throw new TelemetryIngressError(400);
  }
};

const requestMethodFromEvent = (event: object, request: LegacyNodeRequest): string | undefined => {
  const method = 'method' in event ? event.method : undefined;
  return typeof method === 'string' ? method : request.method;
};

const requestPathFromEvent = (event: object, request: LegacyNodeRequest): string | undefined => {
  if (typeof request.originalUrl === 'string') return request.originalUrl;
  if (typeof request.url === 'string') return request.url;
  const path = 'path' in event ? event.path : undefined;
  return typeof path === 'string' ? path : undefined;
};

const createLegacyWebRequest = (event: object, request: LegacyNodeRequest, method: string, path: string): Request => {
  const headers = legacyHeaders('headers' in event ? event.headers : undefined);
  const url = nodeRequestURL(headers, request, path);
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : nodeRequestBody(request, nodeResponseFromEvent(event));
  try {
    return new Request(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body, duplex: 'half' }),
    });
  } catch {
    void body?.cancel().catch(() => undefined);
    throw new TelemetryIngressError(400);
  }
};

/** Preserve the H3 1 Node request body as a backpressured Web stream for bounded ingress. */
export const toTelemetryRequest = (event: unknown): Request => {
  if (typeof event !== 'object' || event === null) throw new TelemetryIngressError(400);
  const nodeRequest = nodeRequestFromEvent(event);
  if (nodeRequest !== undefined) {
    const method = requestMethodFromEvent(event, nodeRequest);
    const path = requestPathFromEvent(event, nodeRequest);
    if (method === undefined || path === undefined) throw new TelemetryIngressError(400);
    return createLegacyWebRequest(event, nodeRequest, method, path);
  }

  const webRequest = requestFromEvent(event);
  if (webRequest !== undefined) return webRequest;
  throw new TelemetryIngressError(400);
};

const contextClientAddress = (event: object): string | undefined => {
  if (!('context' in event)) return undefined;
  const context = event.context;
  if (typeof context !== 'object' || context === null || !('clientAddress' in context)) return undefined;
  const address = context.clientAddress;
  return typeof address === 'string' ? address : undefined;
};

const nodeClientAddress = (event: object): string | undefined => {
  const socket = nodeRequestFromEvent(event)?.socket;
  if (typeof socket !== 'object' || socket === null || !('remoteAddress' in socket)) return undefined;
  const address = socket.remoteAddress;
  return typeof address === 'string' ? address : undefined;
};

const eventClientAddress = (event: object): string | undefined =>
  contextClientAddress(event) ?? nodeClientAddress(event);

export const telemetryClientAddress = (event: unknown, request: Request): string | undefined => {
  if (typeof event === 'object' && event !== null) {
    const address = eventClientAddress(event);
    if (address !== undefined) return address;
  }
  return request.headers.get('cf-connecting-ip') ?? undefined;
};
