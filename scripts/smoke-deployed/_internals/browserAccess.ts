import { Effect } from 'effect';
import type { BrowserContext, Route } from 'playwright';

import { ACCESS_HEADER_NAMES, type SmokeConfig } from './config.ts';
import { SmokeFailure } from './errors.ts';

export const playwrightCall = <A>(stage: string, call: () => PromiseLike<A>): Effect.Effect<A, SmokeFailure> =>
  Effect.tryPromise({
    try: call,
    catch: () => new SmokeFailure(stage),
  });

// Keep valid subscriptions native: a routing proxy can change the handshake/frame events being verified.
const installSocketOriginGuard = (context: BrowserContext, allowedOrigin: string) =>
  playwrightCall('browser-access', () =>
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
    }, allowedOrigin),
  );

const handleScopedRoute = (route: Route, config: SmokeConfig): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    const requestUrl = yield* Effect.try({
      try: () => new URL(route.request().url()),
      catch: () => new SmokeFailure('browser-route'),
    });

    if (requestUrl.protocol === 'ws:' || requestUrl.protocol === 'wss:') {
      if (requestUrl.origin !== config.socketOrigin.origin)
        return yield* Effect.fail(new SmokeFailure('socket-origin'));

      yield* playwrightCall('browser-route', () => route.continue());

      return;
    }

    const headers = yield* Effect.try({
      try: () => ({ ...route.request().headers() }),
      catch: () => new SmokeFailure('browser-route'),
    });

    for (const name of ACCESS_HEADER_NAMES) delete headers[name];

    if (requestUrl.origin !== config.frontendOrigin.origin && requestUrl.origin !== config.socketHttpOrigin) {
      yield* playwrightCall('browser-route', () => route.abort('blockedbyclient'));

      return;
    }

    // route.fetch does not decode zstd before fulfillment; Firefox otherwise renders compressed document bytes.
    Object.assign(headers, config.local ? undefined : config.accessHeaders, {
      'accept-encoding': 'gzip, deflate, br',
    });

    // Fetch each response without following redirects; a redirected browser request must pass this origin check anew.
    const response = yield* playwrightCall('browser-route', () =>
      route.fetch({ headers, maxRedirects: 0, timeout: 30_000 }),
    );

    yield* playwrightCall('browser-route', () => route.fulfill({ response }));
  }).pipe(
    Effect.catch(() =>
      playwrightCall('browser-route', () => route.abort('blockedbyclient')).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );

/**
 * Context headers authenticate browser WebSocket handshakes. All HTTP requests are checked against the two fixed
 * hosts and fetched with redirects disabled so credentials cannot follow an off-host redirect. No service workers
 * may bypass routing. WebSockets are blocked unless the destination is the configured read-only events route.
 */
export const installScopedBrowserAccess = (
  context: BrowserContext,
  config: SmokeConfig,
): Effect.Effect<void, SmokeFailure> =>
  Effect.gen(function* () {
    if (!config.local) {
      yield* playwrightCall('browser-access', () => context.setExtraHTTPHeaders(config.accessHeaders));
    }

    yield* playwrightCall('browser-access', () =>
      context.route('**/*', (route) => Effect.runPromise(handleScopedRoute(route, config))),
    );

    yield* installSocketOriginGuard(context, config.socketOrigin.origin);
  });
