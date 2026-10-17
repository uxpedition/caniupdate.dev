import { Effect, Schema, SchemaTransformation } from 'effect';

import { STAGE_ORIGIN, STAGE_SOCKET_ORIGIN } from './configurationKeys.ts';

const NonBlank = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== '', { expected: 'nonblank configuration' }),
);

const RateLimitSchema = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)).pipe(
  Schema.decodeTo(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), SchemaTransformation.numberFromString),
);

const RuntimeSchema = Schema.Struct({
  NUXT_PUBLIC_SITE_URL: Schema.Literal(STAGE_ORIGIN),
  NUXT_PUBLIC_TELEMETRY_ENABLED: Schema.Literals(['true', 'false']),
  AI_BRIEFING_ENDPOINT: NonBlank,
  AI_BRIEFING_API_KEY: NonBlank,
  AI_BRIEFING_MODEL: NonBlank,
  BRIEFING_PUBLIC_URL: Schema.Literal(STAGE_SOCKET_ORIGIN),
  OTEL_EXPORTER_OTLP_ENDPOINT: Schema.optionalKey(Schema.String),
  OTEL_EXPORTER_OTLP_HEADERS: Schema.optionalKey(Schema.String),
  GITHUB_TOKEN: Schema.optionalKey(Schema.String),
  PUBLIC_RATE_LIMIT: RateLimitSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('60'))),
  BRIEFING_GENERATION_RATE_LIMIT: RateLimitSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('3'))),
});

const HeaderSchema = Schema.Record(Schema.String, Schema.String);

export type WorkerSecrets = Readonly<Record<string, string>>;

export class RuntimeSettingsFailure extends Error {}

function readEndpoint(value: string, name: string): URL | undefined {
  if (value === '') return undefined;

  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch {
    throw new RuntimeSettingsFailure(`Invalid ${name}`);
  }

  const clean = !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash;

  if (endpoint.protocol !== 'https:' || !clean) throw new RuntimeSettingsFailure(`Invalid ${name}`);

  return endpoint;
}

function readHeaders(value: string | undefined, name: string): string {
  if (!value) return '{}';

  try {
    const raw: unknown = JSON.parse(value);

    Schema.decodeUnknownSync(HeaderSchema)(raw);
  } catch {
    throw new RuntimeSettingsFailure(`Invalid ${name}; expected a JSON string-to-string header map`);
  }

  return value;
}

function decodeSettings(environment: NodeJS.ProcessEnv) {
  try {
    return Schema.decodeUnknownSync(RuntimeSchema)(environment);
  } catch {
    throw new RuntimeSettingsFailure('Invalid GitLab runtime settings; check the required variables and stage origins');
  }
}

export function readRuntimeSettings(environment: NodeJS.ProcessEnv) {
  const settings = decodeSettings(environment);
  const telemetryEndpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
  const telemetryHeaders = readHeaders(settings.OTEL_EXPORTER_OTLP_HEADERS, 'OTEL_EXPORTER_OTLP_HEADERS');

  const inferenceEndpoint = readEndpoint(settings.AI_BRIEFING_ENDPOINT, 'AI_BRIEFING_ENDPOINT');

  if (
    !inferenceEndpoint?.pathname.endsWith('/chat/completions') ||
    settings.AI_BRIEFING_ENDPOINT.trim() !== settings.AI_BRIEFING_ENDPOINT
  ) {
    throw new RuntimeSettingsFailure('Invalid AI_BRIEFING_ENDPOINT');
  }

  readEndpoint(telemetryEndpoint, 'OTEL_EXPORTER_OTLP_ENDPOINT');

  if (settings.NUXT_PUBLIC_TELEMETRY_ENABLED === 'true' && telemetryEndpoint === '') {
    throw new RuntimeSettingsFailure('NUXT_PUBLIC_TELEMETRY_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT');
  }

  return {
    rateLimits: { public: settings.PUBLIC_RATE_LIMIT, generation: settings.BRIEFING_GENERATION_RATE_LIMIT },
    frontend: {
      NUXT_PUBLIC_SITE_URL: settings.NUXT_PUBLIC_SITE_URL,
      NUXT_PUBLIC_TELEMETRY_ENABLED: settings.NUXT_PUBLIC_TELEMETRY_ENABLED,
      NUXT_OTEL_ENDPOINT: telemetryEndpoint,
      NUXT_OTEL_HEADERS: telemetryHeaders,
    },
    briefing: {
      AI_BRIEFING_ENDPOINT: settings.AI_BRIEFING_ENDPOINT,
      AI_BRIEFING_API_KEY: settings.AI_BRIEFING_API_KEY,
      AI_BRIEFING_MODEL: settings.AI_BRIEFING_MODEL,
      BRIEFING_PUBLIC_URL: settings.BRIEFING_PUBLIC_URL,
      BRIEFING_ALLOWED_ORIGIN: settings.NUXT_PUBLIC_SITE_URL,
      OTEL_EXPORTER_OTLP_ENDPOINT: telemetryEndpoint,
      OTEL_EXPORTER_OTLP_HEADERS: telemetryHeaders,
    },
    evidence: { GITHUB_TOKEN: settings.GITHUB_TOKEN ?? '' },
  };
}
