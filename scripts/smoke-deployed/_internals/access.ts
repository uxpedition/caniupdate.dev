import { randomBytes } from 'node:crypto';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { Duration, Effect, Schema, type Scope } from 'effect';
import { HttpClient, type HttpClientResponse } from 'effect/http';

import { type SmokeConfig, ACCESS_HEADER_NAMES, REQUEST_TIMEOUT_MS, isRayId } from './config.ts';
import { SmokeFailure } from './errors.ts';

type AccessHandshakeResult = {
  readonly status: number;
  readonly location: string | null;
  readonly rayId: string | null;
};

const isAccessLoginLocation = (location: string | null, base: URL): boolean => {
  if (location === null) return false;

  try {
    const target = new URL(location, base);

    return (
      target.protocol === 'https:' &&
      (target.hostname === 'cloudflareaccess.com' || target.hostname.endsWith('.cloudflareaccess.com')) &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
};

const requireAccessRejection = (status: number, location: string | null, base: URL, stage: string): number => {
  if (status === 401 || status === 403 || (status === 302 && isAccessLoginLocation(location, base))) return status;

  throw new SmokeFailure(stage);
};

export const checkUnauthenticatedFrontend = (config: SmokeConfig) =>
  Effect.scoped(
    Effect.gen(function* () {
      const healthUrl = new URL('/api/health', config.frontendOrigin);
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const response = yield* client.get(healthUrl);

      return yield* Effect.try({
        try: () =>
          requireAccessRejection(
            response.status,
            response.headers.location ?? null,
            healthUrl,
            'unauthorized-frontend',
          ),
        catch: () => new SmokeFailure('unauthorized-frontend'),
      });
    }),
  ).pipe(
    Effect.timeout(Duration.millis(REQUEST_TIMEOUT_MS)),
    Effect.mapError(() => new SmokeFailure('unauthorized-frontend')),
  );

function handshakeResult(response: IncomingMessage): AccessHandshakeResult {
  const ray = response.headers['cf-ray'];

  return {
    status: response.statusCode ?? 0,
    location: response.headers.location ?? null,
    rayId: isRayId(ray) ? ray : null,
  };
}

const handshakeRequestOptions = (origin: string, accessHeaders: Record<string, string>) => ({
  method: 'GET',
  headers: {
    ...accessHeaders,
    Connection: 'Upgrade',
    Origin: origin,
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    'Sec-WebSocket-Version': '13',
    Upgrade: 'websocket',
  },
});

const requestSocketHandshake = (
  url: URL,
  origin: string,
  accessHeaders: Record<string, string>,
): Effect.Effect<AccessHandshakeResult, SmokeFailure> =>
  Effect.callback((resume) => {
    let request: ClientRequest | undefined;

    try {
      const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

      request = transport(url, handshakeRequestOptions(origin, accessHeaders), (response) => {
        const result = handshakeResult(response);

        response.resume();
        resume(Effect.succeed(result));
      });

      request.setTimeout(REQUEST_TIMEOUT_MS, () => request?.destroy());
      request.once('upgrade', (response, socket) => {
        const result = handshakeResult(response);

        socket.destroy();
        resume(Effect.succeed(result));
      });
      request.once('error', () => resume(Effect.fail(new SmokeFailure('socket-probe-transport'))));
      request.end();

      return Effect.sync(() => {
        request?.destroy();
      });
    } catch {
      request?.destroy();
      resume(Effect.fail(new SmokeFailure('socket-probe-transport')));
    }
  });

export const checkUnauthenticatedSocket = (
  config: SmokeConfig,
  eventsUrl: string,
): Effect.Effect<number, SmokeFailure> =>
  Effect.gen(function* () {
    const socketUrl = yield* Effect.try({
      try: () => new URL(eventsUrl),
      catch: () => new SmokeFailure('unauthorized-socket'),
    });

    if (
      socketUrl.origin !== config.socketOrigin.origin ||
      !/^\/api\/briefings\/[0-9a-f]{64}\/events$/.test(socketUrl.pathname) ||
      socketUrl.search !== '' ||
      socketUrl.hash !== ''
    ) {
      return yield* Effect.fail(new SmokeFailure('unauthorized-socket'));
    }

    socketUrl.protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:';

    const response = yield* requestSocketHandshake(socketUrl, config.frontendOrigin.origin, {});

    return yield* Effect.try({
      try: () => requireAccessRejection(response.status, response.location, socketUrl, 'unauthorized-socket'),
      catch: (error) => (error instanceof SmokeFailure ? error : new SmokeFailure('unauthorized-socket')),
    });
  });

export const checkPublicSocketRoute = (config: SmokeConfig): Effect.Effect<number, SmokeFailure> =>
  Effect.gen(function* () {
    if (config.target !== 'production') return yield* Effect.fail(new SmokeFailure('public-socket-route'));

    const url = new URL(`/api/briefings/${'0'.repeat(64)}/events`, config.socketHttpOrigin);
    const response = yield* requestSocketHandshake(url, config.frontendOrigin.origin, {});

    if (response.status !== 404) return yield* Effect.fail(new SmokeFailure('public-socket-route'));

    return response.status;
  });

const isClientId = Schema.is(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}\.access$/i)));

const isClientSecret = Schema.is(Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{64}|cfast_[A-Za-z0-9]{48})$/)));

const validateAccessCredentials = (headers: Record<string, string>): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const id = headers[ACCESS_HEADER_NAMES[0]] ?? '';
    const secret = headers[ACCESS_HEADER_NAMES[1]] ?? '';

    const checks = {
      clientIdPresent: id !== '',
      clientSecretPresent: secret !== '',
      clientIdClean: id !== '' && !/[\s"']/.test(id),
      clientSecretClean: secret !== '' && !/[\s"']/.test(secret),
      clientIdFormat: isClientId(id),
      clientSecretFormat: isClientSecret(secret),
    };

    yield* Effect.sync(() => {
      process.stderr.write(JSON.stringify({ stage: 'access-credential-format', ...checks }) + '\n');
    });

    if (!Object.values(checks).every(Boolean)) return yield* Effect.fail(new SmokeFailure('access-credential-format'));
  });

const logAdmission = (probe: 'http' | 'websocket', response: AccessHandshakeResult, url: URL) =>
  Effect.sync(() => {
    process.stderr.write(
      JSON.stringify({
        stage: 'authorized-socket-admission',
        probe,
        status: response.status,
        accessRedirect: isAccessLoginLocation(response.location, url),
        rayId: response.rayId,
      }) + '\n',
    );
  });

const probeHttpAdmission = (url: URL, config: SmokeConfig) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);

      const response = yield* client.get(url, {
        headers: { ...config.accessHeaders, Origin: config.frontendOrigin.origin },
      });

      const ray = response.headers['cf-ray'];

      yield* logAdmission(
        'http',
        {
          status: response.status,
          location: response.headers.location ?? null,
          rayId: isRayId(ray) ? ray : null,
        },
        url,
      );
    }),
  ).pipe(
    Effect.timeout(Duration.millis(REQUEST_TIMEOUT_MS)),
    Effect.mapError(() => new SmokeFailure('authorized-http-admission-transport')),
  );

export const checkAuthorizedSocketAdmission = (config: SmokeConfig) =>
  Effect.gen(function* () {
    yield* validateAccessCredentials(config.accessHeaders);

    const url = new URL(`/api/briefings/${'0'.repeat(64)}/events`, config.socketHttpOrigin);

    yield* probeHttpAdmission(url, config);

    const response = yield* requestSocketHandshake(url, config.frontendOrigin.origin, config.accessHeaders);

    yield* logAdmission('websocket', response, url);

    // No job owns this sentinel hash: an authenticated upgrade reaches the application and returns its 404.
    // This proves host admission, not a completed subscription; only a pending comparison supplies a real job URL.
    if (response.status !== 404) return yield* Effect.fail(new SmokeFailure('authorized-socket-admission'));

    return response.status;
  });

export const authorizedFetch = (
  config: SmokeConfig,
  path: string,
  stage: string,
): Effect.Effect<HttpClientResponse.HttpClientResponse, SmokeFailure, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const target = yield* Effect.try({
      try: () => new URL(path, config.frontendOrigin),
      catch: () => new SmokeFailure(stage),
    });

    if (target.origin !== config.frontendOrigin.origin) return yield* Effect.fail(new SmokeFailure(stage));

    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    return yield* client.get(target, { headers: config.accessHeaders }).pipe(
      Effect.timeout(Duration.millis(REQUEST_TIMEOUT_MS)),
      Effect.mapError(() => new SmokeFailure(stage)),
    );
  });
