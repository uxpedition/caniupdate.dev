import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIEFING_EVIDENCE_MAX_BYTES, BriefingEvidenceSchema } from '#shared/briefing.defs';
import type { BriefingEvidence } from '#shared/briefing.defs';

import { briefingEvidenceHash, generateBriefing, readBriefingConfig } from './generation';
import type { BriefingProviderTarget } from './provider';

// The packet digests were computed by the pre-extraction `createHash('sha256').update(JSON.stringify(evidence),
// 'utf8')`, and the session digest by the same function over the package identity. The packet digests key already-paid
// D1 rows, so they are pinned rather than recomputed here. Numbering sources by packet position re-keyed every packet
// that carries one, so rows stored under the earlier digest are unreachable by design.
const MINIMIST_DIGEST = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';
const CITING_DIGEST = 'e2155eb97008517cbcccba3ec8a6bad5185f31aadc09503b01a2ec7e7b2e5989';
const SESSION_DIGEST = 'b167eb4a9d136b9104bfb75397a2c28179ae2b3709684ee08df9b13b2eb507ab';
const ENDPOINT = 'https://briefing.example/v1/chat/completions';

const minimistPacket: BriefingEvidence = { packageName: 'minimist', from: '1.2.0', to: '1.2.8', sources: [], gaps: [] };

const citingPacket = (): BriefingEvidence => ({
  packageName: 'minimist',
  from: '1.2.0',
  to: '1.2.8',
  sources: [
    {
      number: 1,
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: ['https://registry.npmjs.org/minimist/1.2.0', 'https://registry.npmjs.org/minimist/1.2.8'],
      text: JSON.stringify({ changed: true, from: '>=14', to: '>=20' }),
    },
    {
      number: 2,
      id: 'coverage',
      kind: 'coverage',
      label: 'Evidence coverage and limitations',
      urls: [],
      text: JSON.stringify({ gaps: ['fixture'] }),
    },
  ],
  gaps: ['fixture'],
});

const gappedPacket = (): BriefingEvidence => ({
  packageName: 'minimist',
  from: '1.2.0',
  to: '1.2.8',
  sources: [
    {
      number: 1,
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: [],
      text: JSON.stringify({ changed: false }),
    },
    {
      number: 2,
      id: 'comparison.dependencies',
      kind: 'fact',
      label: 'Computed dependency declaration comparison',
      urls: [],
      text: '[]',
    },
    {
      number: 3,
      id: 'release.1.2.8',
      kind: 'maintainer',
      label: 'GitHub release 1.2.8',
      urls: ['https://example.com/release'],
      text: 'Fixes a regression.',
    },
    {
      number: 4,
      id: 'coverage',
      kind: 'coverage',
      label: 'Evidence coverage and limitations',
      urls: [],
      text: JSON.stringify({ gaps: [] }),
    },
  ],
  gaps: [],
});

const target: BriefingProviderTarget = {
  apiUrl: 'https://briefing.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
};

const validBullets = [
  {
    kind: 'migration',
    basis: 'inference',
    text: 'The target declares Node >=20; update Node 18 runtimes before upgrading.',
    evidenceNumbers: [1],
  },
];

/** The same citation as the response reports it: the kept source renumbered to display position zero. */
const responseBullets = validBullets.map((bullet) => ({ ...bullet, evidenceNumbers: [0] }));

const providerResponse = (body = validBullets, finishReason = 'stop') =>
  Response.json({
    id: 'chatcmpl-fixture',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: 'assistant', content: JSON.stringify({ bullets: body }) },
      },
    ],
  });

const fetchMock = vi.fn<typeof fetch>();

const run = (evidence: BriefingEvidence) =>
  Effect.runPromise(generateBriefing(evidence, target).pipe(Effect.provide(FetchHttpClient.layer)));

describe('briefingEvidenceHash', () => {
  it('keeps the stored D1 key of a decoded evidence packet', () => {
    const decoded = Schema.decodeUnknownSync(BriefingEvidenceSchema)(minimistPacket, { errors: 'all' });

    expect(briefingEvidenceHash(decoded)).toBe(MINIMIST_DIGEST);
    expect(briefingEvidenceHash(minimistPacket)).toBe(MINIMIST_DIGEST);
    expect(briefingEvidenceHash(citingPacket())).toBe(CITING_DIGEST);
  });
});

describe('generateBriefing', () => {
  beforeEach(() => {
    // The target is the only provider configuration: ambient process settings must not reach the request.
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://ambient.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'ambient-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'ambient-model');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('produces an available cited briefing for the explicit provider target', async () => {
    fetchMock.mockImplementation(async () => providerResponse());

    const result = await run(citingPacket());

    expect(result).toMatchObject({ status: 'available', model: 'test-model', bullets: responseBullets });
    expect(result.sources.map(({ id }) => id)).toEqual(['comparison.node', 'coverage']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('Expected one provider request');
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe(ENDPOINT);
    expect(request.headers.get('authorization')).toBe('Bearer test-key');
    expect(request.headers.get('user-agent')).toBe('can-i-update/ai-briefing');
    expect(request.headers.get('x-opencode-session')).toBe(SESSION_DIGEST);
    const body: unknown = await request.json();
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 4096,
      messages: [{ role: 'system' }, { role: 'user' }],
    });
    expect(JSON.stringify(body)).toContain(citingPacket().packageName);
  });

  it('drops uncited sources and renumbers the kept ones from zero', async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse([
        { kind: 'change', basis: 'maintainer', text: 'The release fixes a regression.', evidenceNumbers: [3] },
      ]),
    );

    const result = await run(gappedPacket());

    expect(result).toMatchObject({ status: 'available', bullets: [{ evidenceNumbers: [0] }] });
    if (result.status !== 'available') throw new Error('Expected an available briefing');
    expect(result.sources.map(({ number, id }) => [number, id])).toEqual([
      [0, 'release.1.2.8'],
      [1, 'coverage'],
    ]);
  });

  it('retries exactly once when the provider output is invalid', async () => {
    fetchMock.mockResolvedValueOnce(providerResponse([])).mockImplementation(async () => providerResponse());

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'available' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers from an undecodable provider envelope with one fresh generation', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ choices: 'invalid' }))
      .mockImplementation(async () => providerResponse());

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'available' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the single retry when both provider outputs are invalid', async () => {
    fetchMock.mockImplementation(async () => providerResponse([]));

    await expect(run(citingPacket())).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes no second request when the provider fails at the HTTP layer', async () => {
    fetchMock.mockResolvedValue(new Response('provider failure', { status: 503 }));

    await expect(run(citingPacket())).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider-error',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a bullet that cites evidence the packet does not contain', async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse([
        { kind: 'change', basis: 'fact', text: 'Unknown.', evidenceNumbers: [9] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceNumbers: [1] },
      ]),
    );

    await expect(run(citingPacket())).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a generated coverage bullet instead of accepting disclaimer padding', async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse([
        ...validBullets,
        {
          kind: 'coverage',
          basis: 'fact',
          text: 'Application compatibility was not tested.',
          evidenceNumbers: [2],
        },
      ]),
    );

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it.each([
    'https://attacker.example',
    'mailto:attacker@example.com',
    'data:text/plain,secret',
    'javascript:alert(1)',
    '//attacker.example/path',
    'www.attacker.example',
  ])('rejects the inline URI %s that is not a source-index reference', async (uri) => {
    fetchMock.mockImplementation(async () =>
      providerResponse([
        { kind: 'change', basis: 'fact', text: `Read ${uri} for details.`, evidenceNumbers: [1] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceNumbers: [1] },
      ]),
    );

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it('allows an ordinary colon label in cited prose', async () => {
    fetchMock.mockResolvedValue(
      providerResponse([
        { kind: 'change', basis: 'fact', text: 'Node: use the target declaration.', evidenceNumbers: [1] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceNumbers: [1] },
      ]),
    );

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'available' });
  });

  it('accepts a provider envelope that sends explicit nulls for optional fields', async () => {
    // GLM behind OpenCode Go sends `"tool_calls": null`; the provider package's envelope schema rejects it.
    const body = {
      id: 'chatcmpl-null-metadata',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: 'test-model',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          logprobs: null,
          message: {
            role: 'assistant',
            name: null,
            tool_calls: null,
            reasoning_content: 'Considering the evidence.',
            content: JSON.stringify({ bullets: validBullets }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'available', model: 'test-model' });
  });

  it('rejects truncated output after exhausting its one retry', async () => {
    fetchMock.mockImplementation(async () => providerResponse(validBullets, 'length'));

    await expect(run(citingPacket())).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized chunked provider response before collecting it', async () => {
    fetchMock.mockImplementation(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(128 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a provider that never answers as a timeout, and generates on a later attempt', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const pending = run(citingPacket());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(75_000);

    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });

    fetchMock.mockResolvedValue(providerResponse());
    await expect(run(citingPacket())).resolves.toMatchObject({ status: 'available' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the retry inside the original deadline and aborts its pending request', async () => {
    vi.useFakeTimers();
    const firstResponse = Promise.withResolvers<Response>();
    const retryAborted = vi.fn();
    fetchMock
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementation((_input, init) => {
        const signal = init?.signal;
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              retryAborted();
              reject(signal.reason);
            },
            { once: true },
          );
        });
      });
    const pending = run(citingPacket());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(50_000);
    firstResponse.resolve(providerResponse([]));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(retryAborted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('briefing evidence bounds', () => {
  it('keeps a packet over the shared byte bound out of the generation path', () => {
    // `generateBriefing` takes an already-validated packet: the job decodes the submission with the shared schema
    // before it stores anything, and the packet that reaches a provider is that decoded one. The bound therefore has
    // to hold at the schema, not inside a function that deliberately does not re-validate its input.
    const oversized: BriefingEvidence = { ...citingPacket(), gaps: ['x'.repeat(BRIEFING_EVIDENCE_MAX_BYTES)] };

    const decoded = Schema.decodeUnknownSync(BriefingEvidenceSchema)(citingPacket(), { errors: 'all' });
    expect(decoded.packageName).toBe('minimist');
    expect(() => Schema.decodeUnknownSync(BriefingEvidenceSchema)(oversized, { errors: 'all' })).toThrow();
  });
});

describe('readBriefingConfig', () => {
  const complete = {
    AI_BRIEFING_ENDPOINT: ENDPOINT,
    AI_BRIEFING_API_KEY: 'test-key',
    AI_BRIEFING_MODEL: 'test-model',
  };

  it('maps missing and partial settings to the existing sanitized statuses', () => {
    expect(readBriefingConfig({})).toEqual({ status: 'not-configured' });
    expect(readBriefingConfig({ AI_BRIEFING_ENDPOINT: '  ', AI_BRIEFING_API_KEY: '', AI_BRIEFING_MODEL: '' })).toEqual({
      status: 'not-configured',
    });
    expect(readBriefingConfig({ AI_BRIEFING_ENDPOINT: ENDPOINT, AI_BRIEFING_API_KEY: 'test-key' })).toEqual({
      status: 'invalid-config',
    });
    expect(readBriefingConfig({ AI_BRIEFING_MODEL: 'test-model' })).toEqual({ status: 'invalid-config' });
  });

  it('accepts only an endpoint the provider client can call and derives its base URL', () => {
    const invalid = [
      'http://remote.example/v1/chat/completions',
      'https://briefing.example/v1/responses',
      'https://briefing.example/v1/chat/completions?debug=1',
    ];

    for (const endpoint of invalid) {
      expect(readBriefingConfig({ ...complete, AI_BRIEFING_ENDPOINT: endpoint })).toEqual({ status: 'invalid-config' });
    }
    expect(readBriefingConfig(complete)).toEqual({
      status: 'configured',
      value: { apiUrl: 'https://briefing.example/v1', apiKey: 'test-key', model: 'test-model' },
    });
    expect(
      readBriefingConfig({ ...complete, AI_BRIEFING_ENDPOINT: 'http://localhost:8787/v1/chat/completions' }),
    ).toEqual({
      status: 'configured',
      value: { apiUrl: 'http://localhost:8787/v1', apiKey: 'test-key', model: 'test-model' },
    });
  });
});
