import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefingEvidence } from '#shared/briefing.defs';

import { installBriefingSchema, openBriefingD1, type BriefingD1 } from '../../test/helpers/briefingD1';
import { getPackageBriefing } from './packageBriefing';

let directory: string;
let runtime: BriefingD1 | undefined;

const fetchMock = vi.fn<typeof fetch>();
let sequence = 0;

// Miniflare startup dominates this suite, so every test shares one runtime and an explicitly emptied table.
function database() {
  if (runtime === undefined) throw new Error('D1 setup failed');
  return runtime.database;
}

const runBriefing = (value: BriefingEvidence, target = database()) =>
  Effect.runPromise(getPackageBriefing(value, target).pipe(Effect.provide(FetchHttpClient.layer)));

async function withOtherBinding(body: (other: BriefingD1) => Promise<void>): Promise<void> {
  const otherDirectory = await mkdtemp(join(tmpdir(), 'briefing-binding-'));
  const other = await openBriefingD1(otherDirectory);
  try {
    await body(other);
  } finally {
    await other.dispose();
    await rm(otherDirectory, { recursive: true, force: true });
  }
}

const input = (nodeTo = '>=20'): BriefingEvidence => {
  const packageName = `briefing-fixture-${sequence++}`;
  return {
    packageName,
    from: '1.0.0',
    to: '2.0.0',
    sources: [
      {
        id: 'comparison.node',
        kind: 'fact',
        label: 'Computed Node engine declaration comparison',
        urls: [
          `https://registry.npmjs.org/${encodeURIComponent(packageName)}/1.0.0`,
          `https://registry.npmjs.org/${encodeURIComponent(packageName)}/2.0.0`,
        ],
        text: JSON.stringify({ changed: true, from: '>=18', to: nodeTo }),
      },
      {
        id: 'coverage',
        kind: 'coverage',
        label: 'Evidence coverage and limitations',
        urls: [],
        text: JSON.stringify({ gaps: ['fixture'] }),
      },
    ],
    gaps: ['fixture'],
  };
};

const defaultBullets = (): Array<Record<string, unknown>> => [
  {
    kind: 'migration',
    basis: 'inference',
    text: 'The target declares Node >=20; update Node 18 runtimes before upgrading.',
    evidenceIds: ['comparison.node'],
  },
];

const response = (bullets = defaultBullets(), finishReason = 'stop') =>
  Response.json({
    id: 'chatcmpl-fixture',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: 'assistant', content: JSON.stringify({ bullets }) },
      },
    ],
  });

describe('getPackageBriefing', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'briefing-cache-'));
    runtime = await openBriefingD1(directory);
  });

  beforeEach(async () => {
    // One suite runtime, but every test still starts from the authoritative schema and an empty table.
    await installBriefingSchema(database());
    await database().prepare('DELETE FROM package_briefings').run();
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await runtime?.dispose();
    runtime = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('accepts a single cited insight and retains coverage metadata without a disclaimer', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();

    const result = await runBriefing(value);
    expect(result).toMatchObject({ status: 'available', model: 'test-model' });
    expect(result.bullets).toEqual(
      expect.arrayContaining([expect.objectContaining({ evidenceIds: ['comparison.node'] })]),
    );
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'comparison.node' }),
        expect.objectContaining({ id: 'coverage' }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error('Expected one provider request');
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe('https://briefing.example/v1/chat/completions');
    expect(request.headers.get('authorization')).toBe('Bearer test-key');
    expect(request.headers.get('user-agent')).toBe('can-i-update/ai-briefing');
    expect(request.headers.get('x-opencode-session')).toMatch(/^[a-f0-9]{64}$/);
    const body: unknown = await request.json();
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 4096,
      messages: [{ role: 'system' }, { role: 'user' }],
    });
    expect(JSON.stringify(body)).toContain(value.packageName);
  });

  it('rejects newly generated coverage bullets instead of accepting disclaimer padding', async () => {
    fetchMock.mockImplementation(async () =>
      response([
        ...defaultBullets(),
        { kind: 'change', basis: 'fact', text: 'The Node requirement changed.', evidenceIds: ['comparison.node'] },
        {
          kind: 'coverage',
          basis: 'fact',
          text: 'Application compatibility was not tested.',
          evidenceIds: ['coverage'],
        },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it.each(['content', 'envelope'])('recovers from invalid %s with one fresh generation', async (invalidPart) => {
    const invalid = invalidPart === 'content' ? response([]) : Response.json({ choices: 'invalid' });
    fetchMock.mockResolvedValueOnce(invalid).mockImplementation(async () => response());
    const value = input();

    const result = await runBriefing(value);
    expect(result).toMatchObject({ status: 'available' });
    expect(result.sources.map(({ id }) => id).sort()).toEqual(['comparison.node', 'coverage']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(runBriefing(value)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects truncated output after exhausting its one retry', async () => {
    fetchMock.mockImplementation(async () => response(undefined, 'length'));

    await expect(runBriefing(input())).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
  });

  it('accepts provider envelopes that send explicit nulls for optional fields', async () => {
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
            content: JSON.stringify({ bullets: defaultBullets() }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'available', model: 'test-model' });
  });

  it('rejects unknown citations without exposing or caching invalid output after two attempts', async () => {
    fetchMock.mockImplementation(async () =>
      response([
        { kind: 'change', basis: 'fact', text: 'Unknown.', evidenceIds: ['invented'] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceIds: ['comparison.node'] },
      ]),
    );
    const value = input();

    await expect(runBriefing(value)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(async () => response());
    await expect(runBriefing(value)).resolves.toMatchObject({ status: 'available' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    'https://attacker.example',
    'mailto:attacker@example.com',
    'data:text/plain,secret',
    'javascript:alert(1)',
    '//attacker.example/path',
    'www.attacker.example',
  ])('rejects inline URI %s that is not a source-index reference', async (uri) => {
    fetchMock.mockImplementation(async () =>
      response([
        { kind: 'change', basis: 'fact', text: `Read ${uri} for details.`, evidenceIds: ['comparison.node'] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceIds: ['comparison.node'] },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it('allows ordinary colon labels in cited prose', async () => {
    fetchMock.mockResolvedValue(
      response([
        { kind: 'change', basis: 'fact', text: 'Node: use the target declaration.', evidenceIds: ['comparison.node'] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceIds: ['comparison.node'] },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'available' });
  });

  it('does not retry provider failures', async () => {
    fetchMock.mockResolvedValue(new Response('provider failure', { status: 503 }));

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'provider-error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the durable winner when concurrent misses generate different valid briefings', async () => {
    const gate = Promise.withResolvers<void>();
    const texts = ['Run Node >=20 before upgrading.', 'Upgrade Node 18 deployments to at least Node 20.'];
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      const text = texts[calls++];
      await gate.promise;
      return response([{ kind: 'migration', basis: 'inference', text, evidenceIds: ['comparison.node'] }]);
    });
    const value = input();
    const pending = Promise.all([runBriefing(value), runBriefing(value)]);
    try {
      // Hold both generations before either can persist, forcing the first-writer-wins race.
      await vi.waitFor(() => expect(calls).toBe(2));
    } finally {
      gate.resolve();
      await pending;
    }

    const [firstResult, secondResult] = await pending;
    expect(firstResult).toMatchObject({ status: 'available' });
    expect(texts).toContain(firstResult.bullets[0]?.text);
    expect(secondResult).toEqual(firstResult);
    await expect(runBriefing(value)).resolves.toEqual(firstResult);
    expect(calls).toBe(2);
  });

  it('retains old snapshots and generates only when the evidence changes', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    const original = await runBriefing(value);
    expect(original).toMatchObject({ status: 'available' });

    const changedEvidence: BriefingEvidence = {
      ...value,
      sources: value.sources.map((source) =>
        source.id === 'comparison.node'
          ? { ...source, text: JSON.stringify({ changed: true, from: '>=18', to: '>=22' }) }
          : source,
      ),
    };
    const changed = await runBriefing(changedEvidence);
    expect(changed).toMatchObject({ status: 'available' });
    expect(changed.sources.find(({ id }) => id === 'comparison.node')?.text).toContain('>=22');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubEnv('AI_BRIEFING_MODEL', 'changed-model');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'rotated-key');
    await expect(runBriefing(value)).resolves.toEqual(original);
    await expect(runBriefing(changedEvidence)).resolves.toEqual(changed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a persisted response after module reload and years without provider configuration', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    const original = await runBriefing(value);
    expect(original).toMatchObject({ status: 'available' });

    // Reopen the same directory with a fresh runtime: the stored row, not a cache, has to supply the result. Dispose
    // first so only one runtime owns the database files, and clear the handle before awaiting so teardown stays safe.
    const current = runtime;
    if (current === undefined) throw new Error('D1 setup failed');
    runtime = undefined;
    await current.dispose();
    runtime = await openBriefingD1(directory);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-01-01'));

    // A static import cannot exercise loading a fresh module against the reopened durable store.
    vi.resetModules();
    const reloaded = await import('./packageBriefing');
    vi.stubEnv('AI_BRIEFING_ENDPOINT', '');
    vi.stubEnv('AI_BRIEFING_MODEL', '');
    vi.stubEnv('AI_BRIEFING_API_KEY', '');
    await expect(
      Effect.runPromise(reloaded.getPackageBriefing(value, database()).pipe(Effect.provide(FetchHttpClient.layer))),
    ).resolves.toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an evidence packet that exceeds the shared byte bound before provider configuration', async () => {
    fetchMock.mockImplementation(async () => response());
    const oversized: BriefingEvidence = { ...input(), gaps: ['x'.repeat(48 * 1024)] };

    await expect(runBriefing(oversized)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not spend an AI request when the schema is missing', async () => {
    fetchMock.mockImplementation(async () => response());
    await database().prepare('DROP TABLE package_briefings').run();

    await expect(runBriefing(input())).resolves.toEqual({
      status: 'unavailable',
      reason: 'cache-error',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the request carries no binding', async () => {
    fetchMock.mockImplementation(async () => response());

    await expect(
      Effect.runPromise(getPackageBriefing(input(), undefined).pipe(Effect.provide(FetchHttpClient.layer))),
    ).resolves.toEqual({ status: 'unavailable', reason: 'cache-error', bullets: [], sources: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of an uncached success', async () => {
    fetchMock.mockImplementation(async () => {
      // The provider answers after the stored snapshot was read, but the schema disappears before the write.
      await database().prepare('DROP TABLE package_briefings').run();
      return response();
    });

    await expect(runBriefing(input())).resolves.toEqual({
      status: 'unavailable',
      reason: 'cache-error',
      bullets: [],
      sources: [],
    });
  });

  it("reports one binding's storage failure instead of another binding's stored success", async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    await expect(runBriefing(value)).resolves.toMatchObject({ status: 'available' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await withOtherBinding(async (other) => {
      await other.database.prepare('DROP TABLE package_briefings').run();
      await expect(runBriefing(value, other.database)).resolves.toEqual({
        status: 'unavailable',
        reason: 'cache-error',
        bullets: [],
        sources: [],
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generates for the same evidence on a second binding rather than reusing the first binding's cache", async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    const original = await runBriefing(value);
    expect(original).toMatchObject({ status: 'available' });

    await withOtherBinding(async (other) => {
      await expect(runBriefing(value, other.database)).resolves.toEqual(original);
    });

    // An isolated binding cannot answer from another environment's cache, so it pays for its own request.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers after a deadline failure because unavailable results are not cached', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const value = input();
    const pending = runBriefing(value);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(75_000);
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });

    fetchMock.mockResolvedValue(response());
    await expect(runBriefing(value)).resolves.toMatchObject({ status: 'available' });
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
    const pending = runBriefing(input());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(50_000);
    firstResponse.resolve(response([]));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(retryAborted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports invalid and absent configuration without making a request', async () => {
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'http://remote.example/chat/completions');
    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-config' });
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/responses');
    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-config' });
    vi.stubEnv('AI_BRIEFING_ENDPOINT', '');
    vi.stubEnv('AI_BRIEFING_API_KEY', '');
    vi.stubEnv('AI_BRIEFING_MODEL', '');
    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
