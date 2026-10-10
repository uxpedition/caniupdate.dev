import { createServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';
import { decodeTelemetryHeaders } from '#shared/telemetry/telemetryConfig.defs';
import { telemetryWaitUntil } from '#shared/telemetry/telemetryContext';

import { telemetryClientAddress, toTelemetryRequest } from '../../../telemetry/h3Event';
import {
  TELEMETRY_BODY_READ_TIMEOUT_MS,
  TELEMETRY_MAX_BODY_BYTES,
  TelemetryIngressError,
  createTelemetryAdmission,
  handleTelemetryIngress,
  isSameOriginTelemetryRequest,
  readBoundedTelemetryBody,
} from './ingress';

const logPayload = () => ({
  resourceLogs: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'can-i-update-briefing' } }],
        droppedAttributesCount: 0,
      },
      scopeLogs: [
        {
          scope: { name: 'can-i-update-nuxt' },
          logRecords: [
            {
              timeUnixNano: '1700000000000000000',
              observedTimeUnixNano: '1700000000000000000',
              severityNumber: 9,
              severityText: 'Info',
              body: { stringValue: 'comparison.page.opened' },
              attributes: [],
              droppedAttributesCount: 0,
              traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
              spanId: '00f067aa0ba902b7',
            },
          ],
        },
      ],
    },
  ],
});

const tracePayload = () => ({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'can-i-update-nuxt' } },
          { key: 'host.name', value: { stringValue: 'private-host-label' } },
          { key: 'url.full', value: { stringValue: 'https://browser-secret.example/private' } },
        ],
        droppedAttributesCount: 0,
      },
      scopeSpans: [
        {
          scope: { name: 'can-i-update-briefing' },
          spans: [
            {
              traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
              spanId: '00f067aa0ba902b7',
              name: 'comparison.page',
              kind: 1,
              startTimeUnixNano: '1',
              endTimeUnixNano: '2',
              attributes: [
                {
                  key: 'exception.message',
                  value: { stringValue: 'Cannot read properties of undefined for alice@example.com' },
                },
              ],
              droppedAttributesCount: 0,
              events: [],
              droppedEventsCount: 0,
              links: [],
              droppedLinksCount: 0,
              status: { code: 2, message: 'private status text' },
            },
          ],
        },
      ],
    },
  ],
});

const parseJson = (text: string): unknown => {
  const value: unknown = JSON.parse(text);

  return value;
};

type ForwardedRequest = { readonly input: RequestInfo | URL; readonly init?: RequestInit };

const requireForwardedRequest = (forwarded: readonly ForwardedRequest[]) => {
  const request = forwarded[0];

  if (request === undefined) throw new Error('Expected forwarded collector request');

  if (request.init === undefined) throw new Error('Expected collector request options');

  if (typeof request.init.body !== 'string') throw new Error('Expected JSON collector request body');
  const input = request.input instanceof Request ? request.input.url : request.input.toString();

  return { input, init: { ...request.init, body: request.init.body } };
};

const expectTraceExport = (forwarded: readonly ForwardedRequest[]): void => {
  const { input, init } = requireForwardedRequest(forwarded);
  expect(String(input)).toBe('http://127.0.0.1:4318/v1/traces');
  expect(init.method).toBe('POST');
  const headers = new Headers(init.headers);
  expect(headers.get('authorization')).toBe('Bearer collector-secret');
  expect(headers.get('cookie')).toBeNull();

  const forwardedText = String(init.body);
  expect(forwardedText).not.toContain('browser-secret');
  expect(forwardedText).not.toContain('browser-secret.example');
  expect(forwardedText).toContain('Cannot read properties of undefined for [REDACTED]');
  expect(forwardedText).not.toContain('private status text');
  expect(forwardedText).not.toContain('private top-level data');

  const decoded = decodeTelemetryPayload('traces', parseJson(forwardedText));
  const group = decoded.resourceSpans[0];

  if (group === undefined) throw new Error('Expected forwarded trace resource');
  const scope = group.scopeSpans[0];

  if (scope === undefined) throw new Error('Expected forwarded trace scope');
  expect(group.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'can-i-update-browser' } }]);
  expect(group.resource.droppedAttributesCount).toBe(2);
  expect(scope.scope.name).toBe('can-i-update-browser');
};

const expectLogExport = (forwarded: readonly ForwardedRequest[]): void => {
  const { input, init } = requireForwardedRequest(forwarded);
  expect(String(input)).toBe('http://127.0.0.1:4318/v1/logs');
  const payload = decodeTelemetryPayload('logs', parseJson(String(init.body)));
  const group = payload.resourceLogs[0];

  if (group === undefined) throw new Error('Expected forwarded log resource');
  const scope = group.scopeLogs[0];

  if (scope === undefined) throw new Error('Expected forwarded log scope');
  const record = scope.logRecords[0];

  if (record === undefined) throw new Error('Expected forwarded log record');
  expect(group.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'can-i-update-browser' } }]);
  expect(group.resource.droppedAttributesCount).toBe(0);
  expect(scope.scope.name).toBe('can-i-update-browser');
  expect(record.body.stringValue).toBe('comparison.page.opened');
};

describe('telemetry ingress', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only string-valued private upstream headers', () => {
    const headers = decodeTelemetryHeaders('{"authorization":"Bearer collector-secret","attempts":2}');
    expect(new Headers(headers).get('authorization')).toBe('Bearer collector-secret');
    expect(Object.keys(headers)).toEqual(['authorization']);
    expect(new Headers(decodeTelemetryHeaders({ 'x-runtime-key': 'private' })).get('x-runtime-key')).toBe('private');
    expect(Object.keys(decodeTelemetryHeaders('[]'))).toEqual([]);
    expect(Object.keys(decodeTelemetryHeaders('not-json'))).toEqual([]);
  });

  it('allows exact same-origin local LAN requests and rejects other origins', () => {
    expect(
      isSameOriginTelemetryRequest(
        new Request('http://192.168.1.24:3000/api/telemetry/v1/traces', {
          headers: { origin: 'http://192.168.1.24:3000' },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginTelemetryRequest(
        new Request('http://192.168.1.24:3000/api/telemetry/v1/traces', {
          headers: { origin: 'http://192.168.1.25:3000' },
        }),
      ),
    ).toBe(false);
    expect(isSameOriginTelemetryRequest(new Request('http://localhost:3000/api/telemetry/v1/traces'))).toBe(false);
  });

  it('converts a legacy H3 Node request into a cancellable bounded Web stream', async () => {
    const incoming = new PassThrough();

    const request = toTelemetryRequest({
      method: 'POST',
      path: '/api/telemetry/v1/traces',
      headers: new Headers({
        'content-type': 'application/json',
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      }),
      req: incoming,
      node: { req: incoming },
    });

    incoming.end(new Uint8Array(TELEMETRY_MAX_BODY_BYTES + 1));

    await expect(readBoundedTelemetryBody(request)).rejects.toMatchObject({ statusCode: 413 });
    expect(incoming.destroyed).toBe(true);
  });

  it('uses the streamed IncomingMessage instead of Nitro’s synthetic Cloudflare GET request', async () => {
    const incoming = new IncomingMessage(new Socket());
    incoming.method = 'POST';
    incoming.url = '/api/telemetry/v1/traces';

    const request = toTelemetryRequest({
      method: 'POST',
      path: '/api/telemetry/v1/traces',
      headers: new Headers({
        'content-type': 'application/json',
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      }),
      req: incoming,
      node: { req: incoming },
      context: { cloudflare: { request: new Request('http://localhost:3000/api/telemetry/v1/traces') } },
    });

    incoming.push('{"actual":"post"}');
    incoming.push(null);

    expect(request.method).toBe('POST');
    await expect(readBoundedTelemetryBody(request)).resolves.toEqual({ actual: 'post' });
    incoming.destroy();
  });

  it('reads client identity from legacy Node requests and Cloudflare headers', () => {
    const incoming = Object.assign(new PassThrough(), { socket: { remoteAddress: '192.0.2.21' } });
    const nodeRequest = new Request('http://localhost:3000');

    const cloudflareRequest = new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '192.0.2.22' },
    });

    expect(telemetryClientAddress({ req: incoming }, nodeRequest)).toBe('192.0.2.21');
    expect(telemetryClientAddress({}, cloudflareRequest)).toBe('192.0.2.22');
  });

  it('uses the Nitro context lifecycle hook with its receiver', () => {
    const context = {
      scheduled: false,
      waitUntil() {
        this.scheduled = true;
      },
    };

    const waitUntil = telemetryWaitUntil(context);

    if (waitUntil === undefined) throw new Error('Expected Nitro lifecycle hook');

    waitUntil(Promise.resolve());

    expect(context.scheduled).toBe(true);
  });

  it('uses the Cloudflare context lifecycle hook when Nitro has no direct hook', () => {
    const context = {
      cloudflare: {
        context: {
          scheduled: false,
          waitUntil() {
            this.scheduled = true;
          },
        },
      },
    };

    const waitUntil = telemetryWaitUntil(context);

    if (waitUntil === undefined) throw new Error('Expected Cloudflare lifecycle hook');

    waitUntil(Promise.resolve());

    expect(context.cloudflare.context.scheduled).toBe(true);
  });

  it('returns an oversized-upload rejection before closing the Node request', async () => {
    const server = createServer((incoming, outgoing) => {
      const request = toTelemetryRequest({
        node: { req: incoming, res: outgoing },
        headers: new Headers({
          host: incoming.headers.host ?? '',
          origin: incoming.headers.origin ?? '',
          'content-type': incoming.headers['content-type'] ?? '',
          'content-length': incoming.headers['content-length'] ?? '',
        }),
      });

      void readBoundedTelemetryBody(request)
        .then(
          () => {
            outgoing.statusCode = 204;
          },
          (error: unknown) => {
            outgoing.statusCode = error instanceof TelemetryIngressError ? error.statusCode : 500;
          },
        )
        .finally(() => {
          outgoing.end();
        });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();

      if (address === null || typeof address === 'string') throw new Error('Expected isolated HTTP listener');
      const origin = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${origin}/api/telemetry/v1/traces`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: 'x'.repeat(TELEMETRY_MAX_BODY_BYTES + 1),
        signal: AbortSignal.timeout(5_000),
      });

      expect(response.status).toBe(413);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a streamed body as soon as it exceeds the byte limit', async () => {
    let cancelled = false;

    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(TELEMETRY_MAX_BODY_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    };

    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', requestInit);

    await expect(readBoundedTelemetryBody(request)).rejects.toMatchObject({ statusCode: 413 });
    expect(cancelled).toBe(true);
  });

  it('cancels a stalled request body within its intake deadline', async () => {
    vi.useFakeTimers();
    let cancelled = false;

    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: new ReadableStream<Uint8Array>({
        pull() {
          // Keep this upload open until the intake deadline cancels it.
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    };

    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', requestInit);
    const admission = createTelemetryAdmission();

    const reading = handleTelemetryIngress(request, 'traces', {
      endpoint: 'http://127.0.0.1:4318',
      admission,
      clientKey: '192.0.2.20',
      waitUntil: () => undefined,
    });

    const rejection = expect(reading).rejects.toMatchObject({ statusCode: 408 });
    await vi.advanceTimersByTimeAsync(TELEMETRY_BODY_READ_TIMEOUT_MS);
    await rejection;
    expect(cancelled).toBe(true);

    const releases: Array<() => void> = [];

    for (let request = 0; request < 8; request += 1) {
      const release = admission.acquire(`192.0.2.${request + 30}`);

      if (release === undefined) throw new Error('Expected stalled request capacity to be released');
      releases.push(release);
    }

    for (const release of releases) release();
  });

  it('cancels a stalled upload when admission rejects it before reading', async () => {
    let cancelled = false;

    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: new ReadableStream<Uint8Array>({
        pull() {
          // This upload never produces bytes; admission must cancel it without starting the body deadline.
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    };

    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', requestInit);
    const admission = createTelemetryAdmission();
    const releases: Array<() => void> = [];

    for (let active = 0; active < 8; active += 1) {
      const release = admission.acquire(`192.0.2.${active + 30}`);

      if (release === undefined) throw new Error('Expected admission capacity to be occupied');
      releases.push(release);
    }

    await expect(
      handleTelemetryIngress(request, 'traces', {
        endpoint: 'http://127.0.0.1:4318',
        admission,
        clientKey: '192.0.2.20',
        waitUntil: () => undefined,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    await Promise.resolve();
    expect(cancelled).toBe(true);

    for (const release of releases) release();
  });

  it('rejects non-JSON media types before parsing', async () => {
    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'http://localhost:3000' },
      body: '{}',
    });

    await expect(readBoundedTelemetryBody(request)).rejects.toMatchObject({ statusCode: 415 });
  });

  it('bounds concurrent requests, per-client rate, and remembered clients', () => {
    vi.useFakeTimers();
    const concurrent = createTelemetryAdmission();
    const releases: Array<() => void> = [];

    for (let request = 0; request < 8; request += 1) {
      const release = concurrent.acquire('192.0.2.2');

      if (release === undefined) throw new Error('Expected admission under the concurrent limit');
      releases.push(release);
    }

    expect(concurrent.acquire('192.0.2.2')).toBeUndefined();

    for (const release of releases) release();
    const afterRelease = concurrent.acquire('192.0.2.2');

    if (afterRelease === undefined) throw new Error('Expected released capacity to admit another request');
    afterRelease();

    const admission = createTelemetryAdmission();
    let denied = false;

    for (let request = 0; request < 200; request += 1) {
      const release = admission.acquire('192.0.2.1');

      if (release === undefined) {
        denied = true;
        break;
      }

      release();
    }

    expect(denied).toBe(true);

    const bounded = createTelemetryAdmission();
    let distinctClientDenied = false;

    for (let client = 0; client < 400; client += 1) {
      const release = bounded.acquire(`client-${client}`);

      if (release === undefined) {
        distinctClientDenied = true;
        break;
      }

      release();
    }

    expect(distinctClientDenied).toBe(true);
  });

  it('forwards only decoded telemetry to the fixed OTLP path with forced browser identity', async () => {
    const forwarded: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const upstream = Promise.withResolvers<Response>();

    const fetcher: typeof fetch = async (input, init) => {
      forwarded.push({ input, init });

      return upstream.promise;
    };

    const tasks: Promise<void>[] = [];
    const waitUntil = (task: Promise<void>) => tasks.push(task);

    const request = new Request('http://localhost:3000/api/telemetry/v1/traces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        authorization: 'Bearer browser-secret',
        cookie: 'session=browser-secret',
      },
      body: JSON.stringify({ ...tracePayload(), attackerField: 'private top-level data' }),
    });

    const response = await handleTelemetryIngress(request, 'traces', {
      endpoint: 'http://127.0.0.1:4318',
      headers: { authorization: 'Bearer collector-secret' },
      admission: createTelemetryAdmission(),
      clientKey: '192.0.2.10',
      waitUntil,
      fetcher,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{}');
    expect(forwarded).toHaveLength(1);
    const forwarding = tasks[0];

    if (forwarding === undefined) throw new Error('Expected background forwarding to be registered');
    upstream.reject(new Error('collector failure private detail'));
    await forwarding;

    expect(forwarded).toHaveLength(1);
    expectTraceExport(forwarded);
  });

  it('forwards approved log records to the matching OTLP signal path', async () => {
    const forwarded: { input: RequestInfo | URL; init?: RequestInit }[] = [];

    const fetcher: typeof fetch = async (input, init) => {
      forwarded.push({ input, init });

      return new Response(null, { status: 200 });
    };

    const tasks: Promise<void>[] = [];

    const request = new Request('http://localhost:3000/api/telemetry/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(logPayload()),
    });

    const response = await handleTelemetryIngress(request, 'logs', {
      endpoint: 'http://127.0.0.1:4318',
      admission: createTelemetryAdmission(),
      clientKey: '192.0.2.12',
      waitUntil: (task) => tasks.push(task),
      fetcher,
    });

    await Promise.all(tasks);

    expect(response.status).toBe(200);
    expectLogExport(forwarded);
  });

  it('rejects invalid OTLP JSON without forwarding it', async () => {
    const request = new Request('http://localhost:3000/api/telemetry/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{}',
    });

    const fetcher = vi.fn<typeof fetch>();

    await expect(
      handleTelemetryIngress(request, 'logs', {
        endpoint: 'http://127.0.0.1:4318',
        admission: createTelemetryAdmission(),
        clientKey: '192.0.2.13',
        waitUntil: () => undefined,
        fetcher,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-same-origin telemetry without forwarding', async () => {
    const request = new Request('http://localhost:3000/api/telemetry/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://attacker.example' },
      body: '{}',
    });

    const fetcher = vi.fn<typeof fetch>();

    await expect(
      handleTelemetryIngress(request, 'logs', {
        endpoint: 'http://127.0.0.1:4318',
        admission: createTelemetryAdmission(),
        clientKey: '192.0.2.11',
        waitUntil: () => undefined,
        fetcher,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
