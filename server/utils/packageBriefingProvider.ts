// The OpenAI-compatible provider boundary: request construction through Effect AI, the response byte bound, and the
// envelope normalization that real providers require. Credentials stay inside this module's process-local layer.

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import { Duration, Effect, Layer, Redacted, Stream } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { Headers, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';

// OpenCode Go completes the same request in 6-49 seconds depending on model and load, so the deadline bounds a
// normal provider call rather than a fast one. It covers reading and decoding the response body.
export const REQUEST_TIMEOUT = Duration.seconds(75);
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_OUTPUT_TOKENS = 4096;
const USER_AGENT = 'can-i-npm-update/ai-briefing';
const OMITTED_REBUILT_HEADERS = ['content-encoding', 'content-length'];

export type BriefingProviderTarget = {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly model: string;
};

const hasErrorTag = (value: unknown, tag: string): boolean =>
  typeof value === 'object' && value !== null && '_tag' in value && value._tag === tag;

type ResponseChunks = { chunks: Uint8Array[]; size: number };

// A response without a body fails its stream with `EmptyBodyError`; that is an empty body, not a read failure.
const bufferResponseBody = (
  request: HttpClientRequest.HttpClientRequest,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Uint8Array<ArrayBuffer>, HttpClientError.HttpClientError> =>
  Effect.gen(function* () {
    const chunks = yield* Stream.runFoldEffect(
      response.stream,
      (): ResponseChunks => ({ chunks: [], size: 0 }),
      (acc, chunk) => {
        if (acc.size + chunk.byteLength > MAX_RESPONSE_BYTES) {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.DecodeError({
                request,
                response,
                description: `Provider response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`,
              }),
            }),
          );
        }
        acc.chunks.push(chunk);
        acc.size += chunk.byteLength;
        return Effect.succeed(acc);
      },
    ).pipe(
      Effect.catchIf(
        (error) => hasErrorTag(error, 'HttpClientError') && hasErrorTag(error.reason, 'EmptyBodyError'),
        () => Effect.succeed<ResponseChunks>({ chunks: [], size: 0 }),
      ),
    );

    const body = new Uint8Array(chunks.size);
    let offset = 0;
    for (const chunk of chunks.chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  });

// Some OpenAI-compatible providers send explicit nulls for optional message fields, for example `tool_calls: null`
// from GLM behind OpenCode Go. The provider package's envelope schema accepts null content and reasoning but not null
// tool calls, so metadata nulls are dropped before decoding. Model text is a string and is never altered.
const dropNullProviderFields = (body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  try {
    const envelope: unknown = JSON.parse(new TextDecoder().decode(body), (_key: string, value: unknown) =>
      value === null ? undefined : value,
    );
    return new TextEncoder().encode(JSON.stringify(envelope));
  } catch {
    return body;
  }
};

// The provider client decodes the response body itself, so the byte bound is enforced while buffering and the decoder
// receives a rebuilt response whose body is known to be bounded. Failure bodies and null-body statuses are rebuilt
// without a body: the briefing reports only a sanitized reason, so provider error text must never reach built errors,
// traces, or logs.
export const readBoundedResponse = (
  request: HttpClientRequest.HttpClientRequest,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
  Effect.gen(function* () {
    const nullBodyStatus = response.status === 204 || response.status === 205 || response.status === 304;
    const successful = response.status >= 200 && response.status < 300 && !nullBodyStatus;

    let body: Uint8Array<ArrayBuffer> | null = null;
    if (successful) {
      body = dropNullProviderFields(yield* bufferResponseBody(request, response));
    }

    return HttpClientResponse.fromWeb(
      request,
      new Response(body, {
        status: response.status,
        headers: Headers.removeMany(response.headers, OMITTED_REBUILT_HEADERS),
      }),
    );
  });

// Redirects are never followed: the bearer token must not travel to another origin, and a redirect is reported as a
// provider error instead of being silently completed.
const providerClient = (target: BriefingProviderTarget, session: string) =>
  OpenAiClient.layer({
    apiUrl: target.apiUrl,
    apiKey: Redacted.make(target.apiKey),
    transformClient: (client) =>
      client.pipe(
        HttpClient.followRedirects(0),
        HttpClient.mapRequest((request) =>
          HttpClientRequest.setHeaders(request, {
            'User-Agent': USER_AGENT,
            'x-opencode-session': session,
          }),
        ),
      ),
  });

export const providerLayer = (
  target: BriefingProviderTarget,
  session: string,
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> =>
  OpenAiLanguageModel.layer({
    model: target.model,
    config: { max_output_tokens: MAX_OUTPUT_TOKENS },
  }).pipe(Layer.provide(providerClient(target, session)));
