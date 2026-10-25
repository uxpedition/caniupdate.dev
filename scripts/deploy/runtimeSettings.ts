import { Data, Effect, Schema, SchemaTransformation } from 'effect';

import { isStableReleaseVersion } from '../../shared/site/releaseIdentity.ts';
import { PRODUCTION_ORIGIN, PRODUCTION_SOCKET_ORIGIN, STAGE_ORIGIN, STAGE_SOCKET_ORIGIN } from './configurationKeys.ts';

const NonBlank = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== '', { expected: 'nonblank configuration' }),
);

const RateLimitSchema = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)).pipe(
  Schema.decodeTo(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), SchemaTransformation.numberFromString),
);

const RuntimeSchema = Schema.Struct({
  NUXT_PUBLIC_SITE_URL: NonBlank,
  NUXT_PUBLIC_TELEMETRY_ENABLED: Schema.Literals(['true', 'false']),
  AI_BRIEFING_ENDPOINT: NonBlank,
  AI_BRIEFING_API_KEY: NonBlank,
  AI_BRIEFING_MODEL: NonBlank,
  BRIEFING_PUBLIC_URL: NonBlank,
  OTEL_EXPORTER_OTLP_ENDPOINT: Schema.optionalKey(Schema.String),
  OTEL_EXPORTER_OTLP_HEADERS: Schema.optionalKey(Schema.String),
  GITHUB_TOKEN: Schema.optionalKey(Schema.String),
  PUBLIC_RATE_LIMIT: RateLimitSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('60'))),
  BRIEFING_GENERATION_RATE_LIMIT: RateLimitSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('3'))),
});

const HeaderSchema = Schema.Record(Schema.String, Schema.String);

export type WorkerSecrets = Readonly<Record<string, string>>;

export class RuntimeSettingsFailure extends Data.TaggedError('RuntimeSettingsFailure')<{
  readonly message: string;
}> {}

const runtimeSettingsFailure = (message: string) => new RuntimeSettingsFailure({ message });

export type DeploymentTarget = 'stage' | 'production';

export type RuntimeSettings = {
  readonly rateLimits: { readonly public: number; readonly generation: number };
  readonly frontend: WorkerSecrets;
  readonly briefing: WorkerSecrets;
  readonly evidence: WorkerSecrets;
};

function readEndpoint(value: string, name: string): Effect.Effect<URL | undefined, RuntimeSettingsFailure> {
  if (value === '') return Effect.succeed(undefined);

  return Effect.gen(function* () {
    const endpoint = yield* Effect.try({
      try: () => new URL(value),
      catch: () => runtimeSettingsFailure(`Invalid ${name}`),
    });

    const clean = !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash;

    if (endpoint.protocol !== 'https:' || !clean) {
      return yield* Effect.fail(runtimeSettingsFailure(`Invalid ${name}`));
    }

    return endpoint;
  });
}

function readHeaders(value: string | undefined, name: string): Effect.Effect<string, RuntimeSettingsFailure> {
  if (!value) return Effect.succeed('{}');

  return Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HeaderSchema), { errors: 'all' })(value).pipe(
      Effect.mapError(() => runtimeSettingsFailure(`Invalid ${name}; expected a JSON string-to-string header map`)),
    );

    return value;
  });
}

const decodeSettings = Schema.decodeUnknownEffect(RuntimeSchema, { errors: 'all' });

const EXPECTED_ORIGINS: Record<DeploymentTarget, { readonly site: string; readonly socket: string }> = {
  stage: { site: STAGE_ORIGIN, socket: STAGE_SOCKET_ORIGIN },
  production: { site: PRODUCTION_ORIGIN, socket: PRODUCTION_SOCKET_ORIGIN },
};

function assertRuntimeOrigins(
  settings: typeof RuntimeSchema.Type,
  target: DeploymentTarget,
): Effect.Effect<void, RuntimeSettingsFailure> {
  const expectedOrigins = EXPECTED_ORIGINS[target];

  if (
    settings.NUXT_PUBLIC_SITE_URL !== expectedOrigins.site ||
    settings.BRIEFING_PUBLIC_URL !== expectedOrigins.socket
  ) {
    return Effect.fail(runtimeSettingsFailure(`Runtime origins do not match the ${target} deployment target`));
  }

  return Effect.void;
}

function readTelemetrySettings(settings: typeof RuntimeSchema.Type) {
  const endpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

  return Effect.gen(function* () {
    const headers = yield* readHeaders(settings.OTEL_EXPORTER_OTLP_HEADERS, 'OTEL_EXPORTER_OTLP_HEADERS');
    yield* readEndpoint(endpoint, 'OTEL_EXPORTER_OTLP_ENDPOINT');

    if (settings.NUXT_PUBLIC_TELEMETRY_ENABLED === 'true' && endpoint === '') {
      return yield* Effect.fail(
        runtimeSettingsFailure('NUXT_PUBLIC_TELEMETRY_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT'),
      );
    }

    return { endpoint, headers };
  });
}

function assertInferenceEndpoint(settings: typeof RuntimeSchema.Type) {
  return Effect.gen(function* () {
    const inferenceEndpoint = yield* readEndpoint(settings.AI_BRIEFING_ENDPOINT, 'AI_BRIEFING_ENDPOINT');

    if (
      !inferenceEndpoint?.pathname.endsWith('/chat/completions') ||
      settings.AI_BRIEFING_ENDPOINT.trim() !== settings.AI_BRIEFING_ENDPOINT
    ) {
      return yield* Effect.fail(runtimeSettingsFailure('Invalid AI_BRIEFING_ENDPOINT'));
    }
  });
}

function readReleaseVersion(environment: NodeJS.ProcessEnv, target: DeploymentTarget, releaseVersion?: string) {
  if (environment.NUXT_PUBLIC_RELEASE_VERSION) {
    return Effect.fail(
      runtimeSettingsFailure('NUXT_PUBLIC_RELEASE_VERSION must be derived from the production release receipt'),
    );
  }

  const receiptVersion = target === 'production' && isStableReleaseVersion(releaseVersion) ? releaseVersion : undefined;

  if (target === 'production' ? receiptVersion === undefined : releaseVersion !== undefined) {
    return Effect.fail(runtimeSettingsFailure('Release version metadata must match the production deployment receipt'));
  }

  return Effect.succeed(receiptVersion);
}

type FrontendSecrets = {
  NUXT_INDEXING_ENABLED: string;
  NUXT_PUBLIC_SITE_URL: string;
  NUXT_PUBLIC_TELEMETRY_ENABLED: string;
  NUXT_PUBLIC_RELEASE_VERSION?: string;
  NUXT_OTEL_ENDPOINT: string;
  NUXT_OTEL_HEADERS: string;
};

function frontendSecrets(
  settings: typeof RuntimeSchema.Type,
  target: DeploymentTarget,
  telemetry: { endpoint: string; headers: string },
  releaseVersion: string | undefined,
) {
  const frontend: FrontendSecrets = {
    NUXT_INDEXING_ENABLED: String(target === 'production'),
    NUXT_PUBLIC_SITE_URL: settings.NUXT_PUBLIC_SITE_URL,
    NUXT_PUBLIC_TELEMETRY_ENABLED: settings.NUXT_PUBLIC_TELEMETRY_ENABLED,
    NUXT_OTEL_ENDPOINT: telemetry.endpoint,
    NUXT_OTEL_HEADERS: telemetry.headers,
  };

  if (releaseVersion !== undefined) frontend.NUXT_PUBLIC_RELEASE_VERSION = releaseVersion;

  return frontend;
}

export function readRuntimeSettings(
  environment: NodeJS.ProcessEnv,
  target: DeploymentTarget,
  releaseVersion?: string,
): Effect.Effect<RuntimeSettings, RuntimeSettingsFailure> {
  return Effect.gen(function* () {
    const releaseReceiptVersion = yield* readReleaseVersion(environment, target, releaseVersion);

    const settings = yield* decodeSettings(environment).pipe(
      Effect.mapError(() =>
        runtimeSettingsFailure('Invalid GitLab runtime settings; check required variables and deployment origins'),
      ),
    );

    yield* assertRuntimeOrigins(settings, target);
    yield* assertInferenceEndpoint(settings);

    const telemetry = yield* readTelemetrySettings(settings);

    return {
      rateLimits: { public: settings.PUBLIC_RATE_LIMIT, generation: settings.BRIEFING_GENERATION_RATE_LIMIT },
      frontend: frontendSecrets(settings, target, telemetry, releaseReceiptVersion),
      briefing: {
        AI_BRIEFING_ENDPOINT: settings.AI_BRIEFING_ENDPOINT,
        AI_BRIEFING_API_KEY: settings.AI_BRIEFING_API_KEY,
        AI_BRIEFING_MODEL: settings.AI_BRIEFING_MODEL,
        BRIEFING_PUBLIC_URL: settings.BRIEFING_PUBLIC_URL,
        BRIEFING_ALLOWED_ORIGIN: settings.NUXT_PUBLIC_SITE_URL,
        OTEL_EXPORTER_OTLP_ENDPOINT: telemetry.endpoint,
        OTEL_EXPORTER_OTLP_HEADERS: telemetry.headers,
      },
      evidence: { GITHUB_TOKEN: settings.GITHUB_TOKEN ?? '' },
    };
  });
}
