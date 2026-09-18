import { createHash } from 'node:crypto';

import { Cache, Cause, Data, Duration, Effect, Exit, Layer, Result, Schema } from 'effect';
import { LanguageModel, Prompt } from 'effect/unstable/ai';
import { FetchHttpClient, HttpClient } from 'effect/unstable/http';

import type {
  BriefingBullet,
  BriefingEvidence,
  BriefingInput,
  BriefingSource,
  BriefingUnavailableReason,
  PackageBriefing,
} from '#shared/briefing.defs';

import { buildBriefingEvidence } from './packageBriefingEvidence';
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_LINES } from './packageBriefingPrompt';
import {
  readBoundedResponse,
  REQUEST_TIMEOUT,
  providerLayer,
  type BriefingProviderTarget,
} from './packageBriefingProvider';

const MAX_BULLET_TEXT = 600;
const MAX_BULLETS = 5;
const MIN_BULLETS = 3;
const MAX_EVIDENCE_IDS = 8;
const INLINE_URL_PATTERN = /(?:^|[^A-Za-z0-9_])(?:[a-z][a-z0-9+.-]*:(?=\S)|\/\/|www\.)/i;
const CHAT_COMPLETIONS_SUFFIX = '/chat/completions';

const BriefingContentSchema = Schema.Struct({
  bullets: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(['change', 'migration', 'coverage']),
      basis: Schema.Literals(['fact', 'maintainer', 'inference']),
      text: Schema.String,
      evidenceIds: Schema.Array(Schema.String),
    }),
  ),
});

type ConfiguredBriefing = BriefingProviderTarget & {
  readonly endpoint: string;
  readonly credentialIdentity: string;
};

type BriefingConfig =
  | { readonly status: 'not-configured' }
  | { readonly status: 'invalid-config' }
  | { readonly status: 'configured'; readonly value: ConfiguredBriefing };

const BriefingInvalidResponseError = Data.TaggedError('BriefingInvalidResponseError')<{
  readonly reason?: never;
}>;
type BriefingInvalidResponseError = InstanceType<typeof BriefingInvalidResponseError>;

const BriefingResponseTooLargeError = Data.TaggedError('BriefingResponseTooLargeError')<{
  readonly actual: number;
  readonly limit: number;
}>;
type BriefingResponseTooLargeError = InstanceType<typeof BriefingResponseTooLargeError>;

const unavailable = (reason: BriefingUnavailableReason): PackageBriefing => ({
  status: 'unavailable',
  reason,
  bullets: [],
  sources: [],
});

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const nonBlankEnvironmentValue = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim() !== '' ? value : undefined;

const isAllowedEndpoint = (rawEndpoint: string): boolean => {
  if (rawEndpoint.trim() !== rawEndpoint) return false;

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    return false;
  }

  if (endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '') return false;
  if (endpoint.protocol === 'https:') return endpoint.hostname !== '';
  if (endpoint.protocol !== 'http:') return false;

  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

// The provider client appends `/chat/completions` to the base URL, so the configured endpoint must be the complete
// URL for that route. Query parameters cannot be carried through the client and are rejected instead of dropped.
const chatCompletionsBaseUrl = (endpoint: string): string | undefined => {
  if (!isAllowedEndpoint(endpoint)) return undefined;

  const url = new URL(endpoint);
  if (url.search !== '' || !url.pathname.endsWith(CHAT_COMPLETIONS_SUFFIX)) return undefined;
  return `${url.origin}${url.pathname.slice(0, -CHAT_COMPLETIONS_SUFFIX.length)}`;
};

const readBriefingConfig = (): BriefingConfig => {
  const endpoint = nonBlankEnvironmentValue(process.env.AI_BRIEFING_ENDPOINT);
  const apiKey = nonBlankEnvironmentValue(process.env.AI_BRIEFING_API_KEY);
  const model = nonBlankEnvironmentValue(process.env.AI_BRIEFING_MODEL);

  if (endpoint === undefined && apiKey === undefined && model === undefined) return { status: 'not-configured' };
  if (endpoint === undefined || apiKey === undefined || model === undefined) return { status: 'invalid-config' };

  const apiUrl = chatCompletionsBaseUrl(endpoint);
  if (apiUrl === undefined) return { status: 'invalid-config' };

  return {
    status: 'configured',
    value: {
      endpoint,
      apiUrl,
      apiKey,
      model,
      credentialIdentity: sha256(apiKey),
    },
  };
};

const invalidResponse = (): BriefingInvalidResponseError => new BriefingInvalidResponseError({});

const hasErrorTag = (value: unknown, tag: string): boolean =>
  typeof value === 'object' && value !== null && '_tag' in value && value._tag === tag;

const hasExactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
};

const parseJson = (content: string): Effect.Effect<unknown, BriefingInvalidResponseError> =>
  Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => invalidResponse(),
  });

const hasValidContentShape = (value: unknown): boolean => {
  if (!hasExactKeys(value, ['bullets']) || !Array.isArray(value.bullets)) return false;
  if (value.bullets.length < MIN_BULLETS || value.bullets.length > MAX_BULLETS) return false;
  return value.bullets.every((bullet) => hasExactKeys(bullet, ['kind', 'basis', 'text', 'evidenceIds']));
};

const sourceIds = (sources: readonly BriefingSource[]): Set<string> | undefined => {
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) return undefined;
    ids.add(source.id);
  }
  return ids;
};

const isValidBullet = (bullet: BriefingBullet, ids: ReadonlySet<string>): boolean => {
  if (
    bullet.text.trim() === '' ||
    Array.from(bullet.text).length > MAX_BULLET_TEXT ||
    INLINE_URL_PATTERN.test(bullet.text)
  ) {
    return false;
  }
  return (
    bullet.evidenceIds.length >= 1 &&
    bullet.evidenceIds.length <= MAX_EVIDENCE_IDS &&
    new Set(bullet.evidenceIds).size === bullet.evidenceIds.length &&
    bullet.evidenceIds.every((id) => ids.has(id))
  );
};

const hasCoverageBullet = (bullets: readonly BriefingBullet[]): boolean =>
  bullets.some((bullet) => bullet.kind === 'coverage' && bullet.evidenceIds.includes('coverage'));

const decodeContent = (
  content: string,
  evidence: BriefingEvidence,
): Effect.Effect<readonly BriefingBullet[], BriefingInvalidResponseError> =>
  Effect.gen(function* () {
    const parsed = yield* parseJson(content);
    if (!hasValidContentShape(parsed)) return yield* Effect.fail(invalidResponse());

    const decoded = yield* Schema.decodeUnknownEffect(BriefingContentSchema)(parsed, { errors: 'all' }).pipe(
      Effect.mapError(() => invalidResponse()),
    );
    const ids = sourceIds(evidence.sources);
    if (ids === undefined || !decoded.bullets.every((bullet) => isValidBullet(bullet, ids))) {
      return yield* Effect.fail(invalidResponse());
    }
    if (!hasCoverageBullet(decoded.bullets)) return yield* Effect.fail(invalidResponse());
    return decoded.bullets;
  });

const collectReferencedSources = (
  bullets: readonly BriefingBullet[],
  sources: readonly BriefingSource[],
): readonly BriefingSource[] => {
  const referenced = new Set(bullets.flatMap((bullet) => bullet.evidenceIds));
  return sources.filter((source) => referenced.has(source.id));
};

// Provider decoding failures surface as `AiError` with an `InvalidOutputError` reason; local citation and shape
// failures use this module's own tags. Everything else, including HTTP status failures, stays a provider error.
const isInvalidProviderOutput = (failure: unknown): boolean => {
  if (hasErrorTag(failure, 'BriefingInvalidResponseError') || hasErrorTag(failure, 'BriefingResponseTooLargeError')) {
    return true;
  }
  if (!hasErrorTag(failure, 'AiError')) return false;
  return (
    typeof failure === 'object' &&
    failure !== null &&
    'reason' in failure &&
    hasErrorTag(failure.reason, 'InvalidOutputError')
  );
};

const briefingCacheIdentity = (key: BriefingCacheKey): string =>
  JSON.stringify([key.evidenceHash, key.endpoint, key.model, key.credentialIdentity, key.promptVersion]);

class BriefingCacheKey extends Data.Class<{
  readonly evidenceHash: string;
  readonly endpoint: string;
  readonly model: string;
  readonly credentialIdentity: string;
  readonly promptVersion: string;
}> {}

type BriefingRequest = {
  readonly config: ConfiguredBriefing;
  readonly evidence: BriefingEvidence;
  readonly session: string;
};

// Cache keys intentionally carry only a one-way credential identity. The request record is process-local and is
// never returned, logged, or used as a diagnostic key; it lets a cache miss still send the original bearer token.
const requestRecords = new Map<string, BriefingRequest>();

const rememberRequest = (key: BriefingCacheKey, request: BriefingRequest): void => {
  const identity = briefingCacheIdentity(key);
  requestRecords.set(identity, request);
  if (requestRecords.size <= 512) return;
  const oldest = requestRecords.keys().next().value;
  if (oldest !== undefined) requestRecords.delete(oldest);
};

const requestBriefing = (request: BriefingRequest): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const prompt = Prompt.make([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [{ type: 'text', text: [...USER_PROMPT_LINES, JSON.stringify(request.evidence)].join('\n\n') }],
      },
    ]);

    const client = yield* HttpClient.HttpClient;
    const boundedClient = client.pipe(
      HttpClient.transform((effect, httpRequest) =>
        Effect.flatMap(effect, (response) => readBoundedResponse(httpRequest, response)),
      ),
    );
    const provider = providerLayer(request.config, request.session).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, boundedClient)),
    );

    const response = yield* LanguageModel.generateText({ prompt }).pipe(
      Effect.provide(provider),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
    );
    if (response.finishReason !== 'stop') return yield* Effect.fail(invalidResponse());

    const bullets = yield* decodeContent(response.text, request.evidence);

    return {
      status: 'available',
      model: request.config.model,
      bullets,
      sources: collectReferencedSources(bullets, request.evidence.sources),
    } satisfies PackageBriefing;
  }).pipe(
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.result,
    Effect.map((result) => {
      if (Result.isSuccess(result)) return result.success;
      if (Cause.isTimeoutError(result.failure)) return unavailable('timeout');
      if (isInvalidProviderOutput(result.failure)) return unavailable('invalid-response');
      return unavailable('provider-error');
    }),
  );

const briefingCache = Effect.runSync(
  Cache.makeWith(
    (key: BriefingCacheKey) => {
      const request = requestRecords.get(briefingCacheIdentity(key));
      return request === undefined ? Effect.succeed(unavailable('provider-error')) : requestBriefing(request);
    },
    {
      capacity: 128,
      requireServicesAt: 'lookup',
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value.status === 'available' ? Duration.hours(1) : Duration.zero,
    },
  ),
);

export function getPackageBriefing(input: BriefingInput): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient> {
  const config = readBriefingConfig();
  if (config.status === 'not-configured') return Effect.succeed(unavailable('not-configured'));
  if (config.status === 'invalid-config') return Effect.succeed(unavailable('invalid-config'));

  let evidence: BriefingEvidence;
  try {
    evidence = buildBriefingEvidence(input);
  } catch {
    return Effect.succeed(unavailable('invalid-response'));
  }

  const key = new BriefingCacheKey({
    evidenceHash: sha256(JSON.stringify(evidence)),
    endpoint: config.value.endpoint,
    model: config.value.model,
    credentialIdentity: config.value.credentialIdentity,
    promptVersion: PROMPT_VERSION,
  });
  rememberRequest(key, {
    config: config.value,
    evidence,
    session: sha256(`${evidence.packageName}\n${evidence.from}\n${evidence.to}`),
  });

  return Cache.get(briefingCache, key);
}
