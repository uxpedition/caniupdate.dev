import { Config, Effect, Schema } from 'effect';

import { STAGE_ORIGIN, STAGE_SOCKET_ORIGIN } from '../../deploy/configurationKeys.ts';
import { SmokeFailure } from './errors.ts';

export const isRayId = Schema.is(Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}(?:-[A-Z]{3})?$/i)));

export const ACCESS_HEADER_NAMES = ['cf-access-client-id', 'cf-access-client-secret'] as const;

export const REQUEST_TIMEOUT_MS = 15_000;

const LOOPBACK_HOSTNAMES = { localhost: true, '127.0.0.1': true, '[::1]': true, '::1': true };

export type SmokeConfig = {
  readonly target: 'local' | 'stage';
  readonly local: boolean;
  readonly frontendOrigin: URL;
  readonly socketOrigin: URL;
  readonly socketHttpOrigin: string;
  readonly expectedSha: string;
  readonly accessHeaders: Record<string, string>;
};

const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== '', { expected: 'a nonblank string' }),
);

const OriginSchema = NonBlankString.check(
  Schema.makeFilter((value) => value === value.trim(), { expected: 'an origin without surrounding whitespace' }),
)
  .pipe(Schema.decodeTo(Schema.URLFromString))
  .check(
    Schema.makeFilter(
      (url) =>
        url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '',
      { expected: 'an origin without credentials, path, query, or fragment' },
    ),
  );

const EnvironmentSchema = Schema.Struct({
  SMOKE_LOCAL: Schema.optionalKey(Schema.Literals(['true', 'false'])),
  SMOKE_TARGET: Schema.optionalKey(Schema.Literal('stage')),
  SMOKE_EXPECTED_SHA: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
});

const LocalOriginsSchema = Schema.Struct({
  SMOKE_ORIGIN: OriginSchema,
  SMOKE_SOCKET_ORIGIN: OriginSchema,
});

const CredentialsSchema = Schema.Struct({
  CF_ACCESS_CLIENT_ID: NonBlankString,
  CF_ACCESS_CLIENT_SECRET: NonBlankString,
});

function isAllowedTarget(local: boolean, frontend: URL, socket: URL): boolean {
  if (!['http:', 'https:'].includes(frontend.protocol) || !['ws:', 'wss:'].includes(socket.protocol)) return false;

  return local
    ? Object.hasOwn(LOOPBACK_HOSTNAMES, frontend.hostname) && Object.hasOwn(LOOPBACK_HOSTNAMES, socket.hostname)
    : frontend.origin === STAGE_ORIGIN && socket.origin === STAGE_SOCKET_ORIGIN;
}

export const readSmokeConfig: Effect.Effect<SmokeConfig, SmokeFailure> = Effect.gen(function* () {
  const environment = yield* Config.schema(EnvironmentSchema);
  const local = environment.SMOKE_LOCAL === 'true';

  if (local ? environment.SMOKE_TARGET !== undefined : environment.SMOKE_TARGET !== 'stage')
    return yield* Effect.fail(new SmokeFailure('configuration'));

  const origins = local
    ? yield* Config.schema(LocalOriginsSchema)
    : { SMOKE_ORIGIN: new URL(STAGE_ORIGIN), SMOKE_SOCKET_ORIGIN: new URL(STAGE_SOCKET_ORIGIN) };
  const frontendOrigin = origins.SMOKE_ORIGIN;
  const socketOrigin = origins.SMOKE_SOCKET_ORIGIN;

  if (socketOrigin.protocol === 'https:') socketOrigin.protocol = 'wss:';
  else if (socketOrigin.protocol === 'http:') socketOrigin.protocol = 'ws:';

  if (!isAllowedTarget(local, frontendOrigin, socketOrigin))
    return yield* Effect.fail(new SmokeFailure('configuration'));

  const accessHeaders: Record<string, string> = {};

  if (!local) {
    const credentials = yield* Config.schema(CredentialsSchema);
    accessHeaders[ACCESS_HEADER_NAMES[0]] = credentials.CF_ACCESS_CLIENT_ID;
    accessHeaders[ACCESS_HEADER_NAMES[1]] = credentials.CF_ACCESS_CLIENT_SECRET;
  }

  const socketHttpOrigin = new URL(socketOrigin.href);
  socketHttpOrigin.protocol = socketOrigin.protocol === 'wss:' ? 'https:' : 'http:';

  return {
    target: local ? 'local' : 'stage',
    local,
    frontendOrigin,
    socketOrigin,
    socketHttpOrigin: socketHttpOrigin.origin,
    expectedSha: environment.SMOKE_EXPECTED_SHA,
    accessHeaders,
  } satisfies SmokeConfig;
}).pipe(Effect.mapError(() => new SmokeFailure('configuration')));
