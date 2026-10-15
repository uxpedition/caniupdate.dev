import { randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { Schema } from 'effect';
import type { BrowserContext } from 'playwright';

const isRayId = Schema.is(Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}(?:-[A-Z]{3})?$/i)));

const FRONTEND_PREVIEW_ORIGIN = 'https://stage.caniupdate.dev';

const SOCKET_PREVIEW_ORIGIN = 'wss://stage-briefing.caniupdate.dev';

const ACCESS_HEADER_NAMES = ['cf-access-client-id', 'cf-access-client-secret'] as const;

const REQUEST_TIMEOUT_MS = 15_000;

const LOOPBACK_HOSTNAMES = { localhost: true, '127.0.0.1': true, '[::1]': true, '::1': true } satisfies Record<
  string,
  true
>;

type AccessHandshakeResult = {
  readonly status: number;
  readonly location: string | null;
  readonly rayId: string | null;
};

export class SmokeFailure extends Error {
  readonly stage: string;

  constructor(stage: string) {
    super(`Smoke failed at ${stage}`);
    this.stage = stage;
  }
}

export type SmokeConfig = {
  readonly local: boolean;
  readonly frontendOrigin: URL;
  readonly socketOrigin: URL;
  readonly socketHttpOrigin: string;
  readonly expectedSha: string;
  readonly accessHeaders: Record<string, string>;
};

const parseOrigin = (raw: string | undefined, stage: string): URL => {
  if (raw === undefined || raw.trim() === '' || raw !== raw.trim()) throw new SmokeFailure(stage);

  try {
    const url = new URL(raw);

    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new SmokeFailure(stage);
    }

    return url;
  } catch {
    throw new SmokeFailure(stage);
  }
};

const normalizeSocketOrigin = (raw: string | undefined, local: boolean): URL => {
  const url = parseOrigin(raw, 'configuration');

  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';

  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new SmokeFailure('configuration');

  if (local ? !Object.hasOwn(LOOPBACK_HOSTNAMES, url.hostname) : url.protocol !== 'wss:')
    throw new SmokeFailure('configuration');

  return url;
};

const requiredEnvironmentValue = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') throw new SmokeFailure('configuration');

  return value;
};

function isLocalMode(): boolean {
  const value = process.env.SMOKE_LOCAL;

  if (value !== undefined && value !== 'true' && value !== 'false') throw new SmokeFailure('configuration');

  return value === 'true';
}

function validateOrigins(local: boolean, frontend: URL, socket: URL): void {
  if (local) {
    if (!['http:', 'https:'].includes(frontend.protocol) || !Object.hasOwn(LOOPBACK_HOSTNAMES, frontend.hostname)) {
      throw new SmokeFailure('configuration');
    }

    return;
  }

  if (frontend.origin !== FRONTEND_PREVIEW_ORIGIN || socket.origin !== SOCKET_PREVIEW_ORIGIN) {
    throw new SmokeFailure('configuration');
  }
}

export const readSmokeConfig = (): SmokeConfig => {
  const local = isLocalMode();
  const frontendOrigin = parseOrigin(process.env.PREVIEW_ORIGIN, 'configuration');
  const socketOrigin = normalizeSocketOrigin(process.env.PREVIEW_SOCKET_ORIGIN, local);
  const expectedSha = requiredEnvironmentValue('PREVIEW_EXPECTED_SHA');

  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new SmokeFailure('configuration');

  validateOrigins(local, frontendOrigin, socketOrigin);

  const accessHeaders: Record<string, string> = {};

  if (!local) {
    accessHeaders[ACCESS_HEADER_NAMES[0]] = requiredEnvironmentValue('CF_ACCESS_CLIENT_ID');
    accessHeaders[ACCESS_HEADER_NAMES[1]] = requiredEnvironmentValue('CF_ACCESS_CLIENT_SECRET');
  }

  const socketHttpOrigin = new URL(socketOrigin.href);
  socketHttpOrigin.protocol = socketOrigin.protocol === 'wss:' ? 'https:' : 'http:';

  return { local, frontendOrigin, socketOrigin, socketHttpOrigin: socketHttpOrigin.origin, expectedSha, accessHeaders };
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

export const checkUnauthenticatedFrontend = async (config: SmokeConfig): Promise<number> => {
  const healthUrl = new URL('/api/health', config.frontendOrigin);

  try {
    const response = await fetch(healthUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const status = response.status;
    const location = response.headers.get('location');

    await response.body?.cancel();

    return requireAccessRejection(status, location, healthUrl, 'unauthorized-frontend');
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;

    throw new SmokeFailure('unauthorized-frontend');
  }
};

function handshakeResult(response: IncomingMessage): AccessHandshakeResult {
  const ray = response.headers['cf-ray'];

  return {
    status: response.statusCode ?? 0,
    location: response.headers.location ?? null,
    rayId: isRayId(ray) ? ray : null,
  };
}

const requestSocketHandshake = async (
  url: URL,
  origin: string,
  accessHeaders: Record<string, string>,
): Promise<AccessHandshakeResult> => {
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const { promise, resolve, reject } = Promise.withResolvers<AccessHandshakeResult>();

  const request = transport(
    url,
    {
      method: 'GET',
      headers: {
        ...accessHeaders,
        Connection: 'Upgrade',
        Origin: origin,
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        Upgrade: 'websocket',
      },
    },
    (response) => {
      const result = handshakeResult(response);

      response.resume();
      resolve(result);
    },
  );

  request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy());
  request.once('upgrade', (response, socket) => {
    const result = handshakeResult(response);

    socket.destroy();
    resolve(result);
  });
  request.once('error', () => reject(new SmokeFailure('socket-probe-transport')));
  request.end();

  return await promise;
};

export const checkUnauthenticatedSocket = async (config: SmokeConfig, eventsUrl: string): Promise<number> => {
  let socketUrl: URL;

  try {
    socketUrl = new URL(eventsUrl);
  } catch {
    throw new SmokeFailure('unauthorized-socket');
  }

  if (
    socketUrl.origin !== config.socketOrigin.origin ||
    !/^\/api\/briefings\/[0-9a-f]{64}\/events$/.test(socketUrl.pathname) ||
    socketUrl.search !== '' ||
    socketUrl.hash !== ''
  ) {
    throw new SmokeFailure('unauthorized-socket');
  }

  socketUrl.protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:';

  try {
    const response = await requestSocketHandshake(socketUrl, config.frontendOrigin.origin, {});

    return requireAccessRejection(response.status, response.location, socketUrl, 'unauthorized-socket');
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;

    throw new SmokeFailure('unauthorized-socket');
  }
};

const isClientId = Schema.is(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}\.access$/i)));

const isClientSecret = Schema.is(Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{64}|cfast_[A-Za-z0-9]{48})$/)));

function validateAccessCredentials(headers: Record<string, string>): void {
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

  process.stderr.write(JSON.stringify({ stage: 'access-credential-format', ...checks }) + '\n');

  if (!Object.values(checks).every(Boolean)) throw new SmokeFailure('access-credential-format');
}

function logAdmission(probe: 'http' | 'websocket', response: AccessHandshakeResult, url: URL): void {
  process.stderr.write(
    JSON.stringify({
      stage: 'authorized-socket-admission',
      probe,
      status: response.status,
      accessRedirect: isAccessLoginLocation(response.location, url),
      rayId: response.rayId,
    }) + '\n',
  );
}

async function probeHttpAdmission(url: URL, config: SmokeConfig): Promise<void> {
  try {
    const response = await fetch(url, {
      headers: { ...config.accessHeaders, Origin: config.frontendOrigin.origin },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const ray = response.headers.get('cf-ray');

    logAdmission(
      'http',
      {
        status: response.status,
        location: response.headers.get('location'),
        rayId: isRayId(ray) ? ray : null,
      },
      url,
    );
    await response.body?.cancel();
  } catch {
    throw new SmokeFailure('authorized-http-admission-transport');
  }
}

export async function checkAuthorizedSocketAdmission(config: SmokeConfig): Promise<number> {
  validateAccessCredentials(config.accessHeaders);

  const url = new URL(`/api/briefings/${'0'.repeat(64)}/events`, config.socketHttpOrigin);

  await probeHttpAdmission(url, config);

  const response = await requestSocketHandshake(url, config.frontendOrigin.origin, config.accessHeaders);

  logAdmission('websocket', response, url);

  // No job owns this sentinel hash: an authenticated upgrade reaches the application and returns its 404.
  // This proves host admission, not a completed subscription; only a pending comparison supplies a real job URL.
  if (response.status !== 404) throw new SmokeFailure('authorized-socket-admission');

  return response.status;
}

export const authorizedFetch = async (config: SmokeConfig, path: string, stage: string): Promise<Response> => {
  const target = new URL(path, config.frontendOrigin);

  if (target.origin !== config.frontendOrigin.origin) throw new SmokeFailure(stage);

  try {
    return await fetch(target, {
      headers: config.accessHeaders,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SmokeFailure(stage);
  }
};

// Keep valid subscriptions native: a routing proxy can change the handshake/frame events being verified.
const installSocketOriginGuard = (context: BrowserContext, allowedOrigin: string) =>
  context.addInitScript((socketOrigin: string) => {
    const NativeWebSocket = window.WebSocket;

    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const target = new URL(url, window.location.href);
        const allowedPath = /^\/api\/briefings\/[0-9a-f]{64}\/events$/.test(target.pathname);

        if (
          target.origin !== socketOrigin ||
          !allowedPath ||
          target.search ||
          target.hash ||
          target.username ||
          target.password
        ) {
          throw new DOMException('Blocked by smoke origin policy', 'SecurityError');
        }

        super(url, protocols);
      }
    };
  }, allowedOrigin);

/**
 * Context headers authenticate browser WebSocket handshakes. All HTTP requests are checked against the two fixed
 * hosts and fetched with redirects disabled so credentials cannot follow an off-host redirect. No service workers
 * may bypass routing. WebSockets are blocked unless the destination is the configured read-only events route.
 */
export const installScopedBrowserAccess = async (context: BrowserContext, config: SmokeConfig): Promise<void> => {
  if (!config.local) await context.setExtraHTTPHeaders(config.accessHeaders);

  await context.route('**/*', async (route) => {
    try {
      const requestUrl = new URL(route.request().url());

      if (requestUrl.protocol === 'ws:' || requestUrl.protocol === 'wss:') {
        if (requestUrl.origin !== config.socketOrigin.origin) throw new SmokeFailure('socket-origin');

        await route.continue();

        return;
      }

      const headers = { ...route.request().headers() };

      for (const name of ACCESS_HEADER_NAMES) delete headers[name];

      if (requestUrl.origin !== config.frontendOrigin.origin && requestUrl.origin !== config.socketHttpOrigin) {
        await route.abort('blockedbyclient');

        return;
      }

      // route.fetch does not decode zstd before fulfillment; Firefox otherwise renders compressed document bytes.
      Object.assign(headers, config.local ? undefined : config.accessHeaders, {
        'accept-encoding': 'gzip, deflate, br',
      });

      // Fetch each response without following redirects; a redirected browser request must pass this origin check anew.
      const response = await route.fetch({ headers, maxRedirects: 0, timeout: 30_000 });

      await route.fulfill({ response });
    } catch {
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });

  await installSocketOriginGuard(context, config.socketOrigin.origin);
};
