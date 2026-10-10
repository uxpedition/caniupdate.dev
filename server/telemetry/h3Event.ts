import { Predicate, Schema } from 'effect';

import { TelemetryIngressError } from '../api/telemetry/_internals/ingress';

/** Declared shapes H3 1 (Node development) and workerd (web) expose; leaves stay unknown and are guarded at use. */
type EventContainer = {
  readonly node?: { readonly req?: unknown; readonly res?: unknown };
  readonly web?: { readonly request?: unknown };
  readonly context?: { readonly cloudflare?: { readonly request?: unknown }; readonly clientAddress?: unknown };
  readonly req?: unknown;
  readonly method?: unknown;
  readonly path?: unknown;
  readonly headers?: unknown;
};

/** Any non-null, non-function container object: the gate before shape probing on a raw event. */
const isEventObject = Schema.is(Schema.Struct({}));

const isScalarString = Schema.is(Schema.String);

const isRequestContainer = Schema.is(Schema.Struct({ request: Schema.Unknown }));

const isRemoteAddressSocket = Schema.is(Schema.Struct({ remoteAddress: Schema.String }));

const isEncryptedHttpSocket = Schema.is(Schema.Struct({ encrypted: Schema.Literal(true) }));

interface LegacyNodeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly originalUrl?: string;
  readonly socket?: unknown;
  on(event: string, listener: (...values: unknown[]) => void): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

interface LegacyNodeResponse {
  readonly writableFinished: boolean;
  once(event: 'finish' | 'close', listener: () => void): void;
}

const isLegacyNodeRequestFields = Schema.is(
  Schema.Struct({
    on: Schema.Unknown,
    pause: Schema.Unknown,
    resume: Schema.Unknown,
    destroy: Schema.Unknown,
  }),
);

const isLegacyNodeResponseFields = Schema.is(
  Schema.Struct({
    writableFinished: Schema.Boolean,
    once: Schema.Unknown,
  }),
);

const isLegacyNodeRequest = (value: unknown): value is LegacyNodeRequest =>
  isLegacyNodeRequestFields(value) &&
  Predicate.isFunction(value.on) &&
  Predicate.isFunction(value.pause) &&
  Predicate.isFunction(value.resume) &&
  Predicate.isFunction(value.destroy);

const isLegacyNodeResponse = (value: unknown): value is LegacyNodeResponse =>
  isLegacyNodeResponseFields(value) && Predicate.isFunction(value.once);

const nodeResponseFromEvent = (event: EventContainer): LegacyNodeResponse | undefined => {
  const node = event.node;

  if (node === undefined) return undefined;

  return isLegacyNodeResponse(node.res) ? node.res : undefined;
};

const legacyHeaders = (
  // oxlint-disable-next-line rules/no-unknown-parameters -- The event headers value is runtime-owned; the concrete Headers instance check is the validation.
  value: unknown,
): Headers => {
  if (!(value instanceof Headers)) throw new TelemetryIngressError(400);

  return value;
};

const textEncoder = new TextEncoder();

type NodeRequestBodyState = { active: boolean };

const enqueueNodeRequestChunk = (
  request: LegacyNodeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: NodeRequestBodyState,
  // oxlint-disable-next-line rules/no-unknown-parameters -- The stream feeds arbitrary chunk representations; each is discriminated below.
  chunk: unknown,
): void => {
  if (!state.active) return;
  request.pause();

  if (isScalarString(chunk)) {
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
  // oxlint-disable-next-line rules/no-unknown-parameters -- Stream failure causes are platform-owned; only their Error shape is narrowed.
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
  request.on('data', (chunk) => enqueueNodeRequestChunk(request, controller, state, chunk));
  request.on('end', () => closeNodeRequestBody(controller, state));
  request.on('error', (error) => failNodeRequestBody(controller, state, error));
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

// oxlint-disable-next-line rules/no-unknown-parameters -- Nested runtime container guarded structurally before the concrete instance check.
const requestFromContainer = (value: unknown): Request | undefined => {
  if (!isRequestContainer(value)) return undefined;

  return value.request instanceof Request ? value.request : undefined;
};

const webRequestFromEvent = (event: EventContainer): Request | undefined => {
  const web = event.web;

  return web === undefined ? undefined : requestFromContainer(web);
};

const cloudflareRequestFromEvent = (event: EventContainer): Request | undefined => {
  if (event.context === undefined) return undefined;

  const cloudflare = event.context.cloudflare;

  return cloudflare === undefined ? undefined : requestFromContainer(cloudflare);
};

const requestFromEvent = (event: EventContainer): Request | undefined => {
  const webRequest = webRequestFromEvent(event);

  if (webRequest !== undefined) return webRequest;
  const cloudflareRequest = cloudflareRequestFromEvent(event);

  if (cloudflareRequest !== undefined) return cloudflareRequest;

  return event.req instanceof Request ? event.req : undefined;
};

const nodeRequestFromEvent = (event: EventContainer): LegacyNodeRequest | undefined => {
  if (isLegacyNodeRequest(event.req)) return event.req;

  const node = event.node;

  if (node === undefined) return undefined;

  return isLegacyNodeRequest(node.req) ? node.req : undefined;
};

const nodeRequestURL = (headers: Headers, request: LegacyNodeRequest, path: string): URL => {
  const host = headers.get('host') ?? 'localhost';
  const forwardedProtocol = headers.get('x-forwarded-proto')?.trim().toLowerCase();
  const socket = request.socket;
  const encrypted = socket !== undefined && isEncryptedHttpSocket(socket);
  const protocol = forwardedProtocol === 'https' || encrypted ? 'https' : 'http';

  try {
    return new URL(path.replace(/^[/\\]+/, '/'), `${protocol}://${host}`);
  } catch {
    throw new TelemetryIngressError(400);
  }
};

const requestMethodFromEvent = (event: EventContainer, request: LegacyNodeRequest): string | undefined => {
  const method = isScalarString(event.method) ? event.method : undefined;

  return method ?? request.method;
};

const requestPathFromEvent = (event: EventContainer, request: LegacyNodeRequest): string | undefined => {
  if (request.originalUrl !== undefined) return request.originalUrl;

  if (request.url !== undefined) return request.url;

  return isScalarString(event.path) ? event.path : undefined;
};

const createLegacyWebRequest = (
  event: EventContainer,
  request: LegacyNodeRequest,
  method: string,
  path: string,
): Request => {
  const headers = legacyHeaders(event.headers);
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
// oxlint-disable-next-line rules/no-unknown-parameters -- Exported event-to-Request boundary; the raw event is runtime-owned and probed shape by shape below.
export const toTelemetryRequest = (event: unknown): Request => {
  if (!isEventObject(event)) throw new TelemetryIngressError(400);
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

const contextClientAddress = (event: EventContainer): string | undefined => {
  if (event.context === undefined) return undefined;

  return isScalarString(event.context?.clientAddress) ? event.context?.clientAddress : undefined;
};

const nodeClientAddress = (event: EventContainer): string | undefined => {
  const socket = nodeRequestFromEvent(event)?.socket;

  const address = socket === undefined || !isRemoteAddressSocket(socket) ? undefined : socket.remoteAddress;

  return address;
};

const eventClientAddress = (event: EventContainer): string | undefined =>
  contextClientAddress(event) ?? nodeClientAddress(event);

// oxlint-disable-next-line rules/no-unknown-parameters -- Exported event-to-address boundary; the raw event is runtime-owned and probed shape by shape below.
export const telemetryClientAddress = (event: unknown, request: Request): string | undefined => {
  if (isEventObject(event)) {
    const address = eventClientAddress(event);

    if (address !== undefined) return address;
  }

  return request.headers.get('cf-connecting-ip') ?? undefined;
};
