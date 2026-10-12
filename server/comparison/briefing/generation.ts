import { createHash } from 'node:crypto';

import { Cause, Data, Effect, Layer, Predicate, Result, Schema } from 'effect';
import { LanguageModel, Prompt } from 'effect/ai';
import { FetchHttpClient, HttpClient } from 'effect/http';

import { BriefingBulletSchema } from '../../../shared/comparison/briefing/briefing.defs';
import type {
  BriefingBullet,
  BriefingEvidence,
  BriefingSource,
  BriefingUnavailableReason,
  PackageBriefing,
} from '../../../shared/comparison/briefing/briefing.defs';
import { SYSTEM_PROMPT, USER_PROMPT_LINES } from './prompt';
import { readBoundedResponse, REQUEST_TIMEOUT, providerLayer, type BriefingProviderTarget } from './provider';

const MAX_BULLET_TEXT = 600;

const MAX_BULLETS = 5;

const MIN_BULLETS = 1;

const MAX_EVIDENCE_NUMBERS = 8;

const INLINE_URL_PATTERN = /(?:^|[^A-Za-z0-9_])(?:[a-z][a-z0-9+.-]*:(?=\S)|\/\/|www\.)/i;

const CHAT_COMPLETIONS_SUFFIX = '/chat/completions';

const BriefingContentSchema = Schema.Struct({
  bullets: Schema.Array(BriefingBulletSchema).check(Schema.isMinLength(MIN_BULLETS), Schema.isMaxLength(MAX_BULLETS)),
});

const BriefingContentJsonSchema = Schema.fromJsonString(BriefingContentSchema);

export type BriefingConfig =
  | { readonly status: 'not-configured' }
  | { readonly status: 'invalid-config' }
  | { readonly status: 'configured'; readonly value: BriefingProviderTarget };

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

// The D1 key of a decoded evidence packet. Retrieval timestamps, model, key, and prompt never enter the digest, so a
// paid response stays a hit. Callers validate the packet against `BriefingEvidenceSchema` before hashing.
export const briefingEvidenceHash = (value: BriefingEvidence): string => sha256(JSON.stringify(value));

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

// The provider settings boundary reads these three names, and it accepts any environment-shaped bag because its
// callers do: the briefing service passes the whole Worker `env` (which declares bindings beyond these settings) and
// tests pass partial objects such as `{}`.
export type BriefingEnvironment =
  | {
      readonly AI_BRIEFING_ENDPOINT?: string;
      readonly AI_BRIEFING_API_KEY?: string;
      readonly AI_BRIEFING_MODEL?: string;
    }
  | Readonly<Record<string, string | undefined>>;

// Parsing is a pure boundary so absence and partial configuration keep their sanitized statuses instead of falling
// through to a provider call.
export const readBriefingConfig = (env: BriefingEnvironment): BriefingConfig => {
  const endpoint = nonBlankEnvironmentValue(env.AI_BRIEFING_ENDPOINT);
  const apiKey = nonBlankEnvironmentValue(env.AI_BRIEFING_API_KEY);
  const model = nonBlankEnvironmentValue(env.AI_BRIEFING_MODEL);

  if (endpoint === undefined && apiKey === undefined && model === undefined) return { status: 'not-configured' };

  if (endpoint === undefined || apiKey === undefined || model === undefined) return { status: 'invalid-config' };

  const apiUrl = chatCompletionsBaseUrl(endpoint);

  if (apiUrl === undefined) return { status: 'invalid-config' };

  return {
    status: 'configured',
    value: { apiUrl, apiKey, model },
  };
};

const invalidResponse = (): BriefingInvalidResponseError => new BriefingInvalidResponseError({});

const isValidBullet = (bullet: BriefingBullet, numbers: ReadonlySet<number>): boolean => {
  // Stored snapshots retain their original kinds; fresh generations contain comparison insights only.
  if (
    bullet.kind === 'coverage' ||
    bullet.text.trim() === '' ||
    Array.from(bullet.text).length > MAX_BULLET_TEXT ||
    INLINE_URL_PATTERN.test(bullet.text)
  ) {
    return false;
  }

  return (
    bullet.evidenceNumbers.length >= 1 &&
    bullet.evidenceNumbers.length <= MAX_EVIDENCE_NUMBERS &&
    new Set(bullet.evidenceNumbers).size === bullet.evidenceNumbers.length &&
    bullet.evidenceNumbers.every((number) => numbers.has(number))
  );
};

const decodeContent = (
  content: string,
  evidence: BriefingEvidence,
): Effect.Effect<readonly BriefingBullet[], BriefingInvalidResponseError> =>
  Effect.gen(function* () {
    // Malformed JSON, missing or excess keys, and out-of-range bullet counts all reject as one invalid response.
    const decoded = yield* Schema.decodeUnknownEffect(BriefingContentJsonSchema)(content, {
      errors: 'all',
      onExcessProperty: 'error',
    }).pipe(Effect.mapError(() => invalidResponse()));

    const numbers = new Set(evidence.sources.map((source) => source.number));

    if (!decoded.bullets.every((bullet) => isValidBullet(bullet, numbers))) {
      return yield* Effect.fail(invalidResponse());
    }

    return decoded.bullets;
  });

/**
 * The response keeps the cited sources plus coverage and renumbers them from zero, so the evidence index reads
 * `[0] … [n]` instead of leaving the gaps a filtered packet position would. Bullets are rewritten to the same
 * numbers, and the packet itself keeps the positions the model cited.
 */
const collectResponseEvidence = (
  bullets: readonly BriefingBullet[],
  sources: readonly BriefingSource[],
): { readonly bullets: readonly BriefingBullet[]; readonly sources: readonly BriefingSource[] } => {
  const referenced = new Set(bullets.flatMap((bullet) => bullet.evidenceNumbers));
  const kept = sources.filter((source) => source.kind === 'coverage' || referenced.has(source.number));
  const displayNumbers = new Map(kept.map((source, position) => [source.number, position]));

  const renumber = (numbers: readonly number[]): number[] =>
    numbers.map((number) => {
      const display = displayNumbers.get(number);

      if (display === undefined) throw new Error('A cited evidence number is missing from the response sources');

      return display;
    });

  return {
    bullets: bullets.map((bullet) => ({ ...bullet, evidenceNumbers: renumber(bullet.evidenceNumbers) })),
    sources: kept.map((source, position) => ({ ...source, number: position })),
  };
};

// Provider decoding failures surface as `AiError` with an `InvalidOutputError` reason; local citation and shape
// failures use this module's own tags. Everything else, including HTTP status failures, stays a provider error.
const isInvalidProviderOutput = (cause: unknown): boolean => {
  if (
    Predicate.isTagged(cause, 'BriefingInvalidResponseError') ||
    Predicate.isTagged(cause, 'BriefingResponseTooLargeError')
  ) {
    return true;
  }

  if (!Predicate.isTagged(cause, 'AiError')) return false;

  return 'reason' in cause && Predicate.isTagged(cause.reason, 'InvalidOutputError');
};

type BriefingRequest = {
  readonly config: BriefingProviderTarget;
  readonly evidence: BriefingEvidence;
  readonly session: string;
};

const requestBriefing = (request: BriefingRequest): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const prompt = Prompt.make([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [...USER_PROMPT_LINES, JSON.stringify(request.evidence)].join('\n\n') },
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

    // Regenerate once on invalid output; reuse the evidence and prompt, never feed rejected text back to the model.
    return yield* Effect.gen(function* () {
      const response = yield* LanguageModel.generateText({ prompt }).pipe(
        Effect.provide(provider),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
      );

      if (response.finishReason !== 'stop') return yield* Effect.fail(invalidResponse());

      const bullets = yield* decodeContent(response.text, request.evidence);
      const evidence = collectResponseEvidence(bullets, request.evidence.sources);

      return {
        status: 'available',
        model: request.config.model,
        bullets: evidence.bullets,
        sources: evidence.sources,
      } satisfies PackageBriefing;
    }).pipe(Effect.retry({ times: 1, while: isInvalidProviderOutput }));
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

// The provider generation boundary: an already-validated packet plus an explicit target. It touches no D1 binding and
// reads no ambient configuration, so a background job can reuse it verbatim.
export const generateBriefing = (
  evidence: BriefingEvidence,
  target: BriefingProviderTarget,
): Effect.Effect<PackageBriefing, never, HttpClient.HttpClient> =>
  requestBriefing({
    config: target,
    evidence,
    session: sha256(`${evidence.packageName}\n${evidence.from}\n${evidence.to}`),
  });
