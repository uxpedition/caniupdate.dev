import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefingInput } from '#shared/briefing.defs';
import type { ComparisonVersion, PackageComparison } from '#shared/comparison.defs';
import type { PackageReleaseNotes } from '#shared/github.defs';

import type * as BriefingModule from './packageBriefing';

let getPackageBriefing: typeof BriefingModule.getPackageBriefing;
let databaseDirectory: string;
let closeStore: () => void;

const fetchMock = vi.fn<typeof fetch>();
let sequence = 0;

const comparison = (nodeTo = '>=20'): PackageComparison => ({
  dependencies: [],
  peers: [],
  node: { changed: true, from: '>=18', to: nodeTo, fromDeclared: true, toDeclared: true },
  moduleFormat: {
    changed: false,
    from: { type: 'commonjs' },
    to: { type: 'commonjs' },
    fromDeclared: true,
    toDeclared: true,
  },
  exports: { changed: false, from: null, to: null, fromDeclared: false, toDeclared: false },
  types: { changed: false, from: null, to: null, fromDeclared: false, toDeclared: false },
  licenses: { changed: false, from: ['MIT'], to: ['MIT'], added: [], removed: [] },
  installScripts: [],
  sizes: {
    unpacked: {
      status: 'unavailable',
      from: null,
      to: null,
      delta: null,
      percent: null,
      reasons: ['fixture'],
      sources: { from: null, to: null },
    },
    bundle: {
      provider: 'bundlephobia',
      methodology: 'provider-estimate',
      minified: { status: 'unavailable', from: null, to: null, delta: null, percent: null, reasons: [] },
      gzip: { status: 'unavailable', from: null, to: null, delta: null, percent: null, reasons: [] },
    },
  },
  advisories: {
    status: 'unavailable',
    coverage: { from: 'unavailable', to: 'unavailable' },
    reasons: ['fixture'],
    fromOnly: [],
    both: [],
    toOnly: [],
    uncertain: [],
  },
});

const version = (packageName: string, value: string): ComparisonVersion => ({
  name: packageName,
  version: value,
  dist: { tarball: `https://registry.npmjs.org/${packageName}/-/${value}.tgz` },
  licenses: ['MIT'],
  deprecated: false,
  engines: { node: '>=18' },
  dependencies: {},
  peerDependencies: {},
  optionalDependencies: {},
  optionalPeers: [],
  installScripts: [],
  installScriptCommands: {},
  moduleFormat: { type: 'commonjs' },
  vulnerabilities: { status: 'unavailable', count: null, advisories: [] },
  bundleSize: {
    provider: 'bundlephobia',
    url: `https://bundlephobia.com/package/${packageName}@${value}`,
    status: 'unavailable',
    size: null,
    gzip: null,
  },
  tarball: {
    status: 'unavailable',
    reasons: ['fixture'],
    url: `https://registry.npmjs.org/${packageName}/-/${value}.tgz`,
    files: [],
    changelogs: [],
  },
});

const input = (nodeTo = '>=20'): BriefingInput => {
  const packageName = `briefing-fixture-${sequence++}`;
  return {
    packageName,
    from: version(packageName, '1.0.0'),
    to: version(packageName, '2.0.0'),
    comparison: comparison(nodeTo),
    releaseNotes: {
      status: 'unavailable',
      reasons: ['fixture'],
      releases: [],
      changelog: null,
    } satisfies PackageReleaseNotes,
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

const runBriefing = (value: BriefingInput) =>
  Effect.runPromise(getPackageBriefing(value).pipe(Effect.provide(FetchHttpClient.layer)));

describe('getPackageBriefing', () => {
  beforeEach(async () => {
    databaseDirectory = await mkdtemp(join(tmpdir(), 'briefing-cache-'));
    vi.stubEnv('AI_BRIEFING_CACHE_PATH', join(databaseDirectory, 'briefings.db'));
    // Fresh module state lets each test exercise disk persistence without inheriting process-local caches.
    vi.resetModules();
    ({ getPackageBriefing } = await import('./packageBriefing'));
    ({ closeBriefingStore: closeStore } = await import('./packageBriefingStore'));
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    closeStore();
    await rm(databaseDirectory, { recursive: true, force: true });
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
    expect(request.headers.get('user-agent')).toBe('can-i-npm-update/ai-briefing');
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

  it('shares the in-flight retry and caches its successful briefing for identical callers', async () => {
    const gate = Promise.withResolvers<Response>();
    fetchMock.mockResolvedValueOnce(response([])).mockImplementation(() => gate.promise);
    const value = input();

    const first = runBriefing(value);
    const second = runBriefing(value);
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    } finally {
      gate.resolve(response());
    }

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ status: 'available' });
    expect(secondResult).toEqual(firstResult);
    await expect(runBriefing(value)).resolves.toEqual(firstResult);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains old snapshots and generates only when the evidence changes', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    const original = await runBriefing(value);
    expect(original).toMatchObject({ status: 'available' });

    const changedEvidence = { ...value, comparison: comparison('>=22') };
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

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-01-01'));
    // Reloading removes every process-local cache; only the database can supply this result.
    closeStore();
    vi.resetModules();
    ({ getPackageBriefing } = await import('./packageBriefing'));
    ({ closeBriefingStore: closeStore } = await import('./packageBriefingStore'));
    vi.stubEnv('AI_BRIEFING_ENDPOINT', '');
    vi.stubEnv('AI_BRIEFING_MODEL', '');
    vi.stubEnv('AI_BRIEFING_API_KEY', '');
    await expect(runBriefing(value)).resolves.toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate when only a bundle retrieval timestamp changes', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();
    const measured = {
      ...value,
      from: {
        ...value.from,
        bundleSize: {
          ...value.from.bundleSize,
          status: 'available',
          name: value.packageName,
          version: value.from.version,
          size: 100,
          gzip: 50,
          retrievedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    } satisfies BriefingInput;
    const original = await runBriefing(measured);
    expect(original).toMatchObject({ status: 'available' });
    const refreshed = {
      ...measured,
      from: { ...measured.from, bundleSize: { ...measured.from.bundleSize, retrievedAt: '2026-02-01T00:00:00.000Z' } },
    };
    await expect(runBriefing(refreshed)).resolves.toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not spend an AI request when the database cannot be opened', async () => {
    vi.stubEnv('AI_BRIEFING_CACHE_PATH', databaseDirectory);
    await expect(runBriefing(input())).resolves.toEqual({
      status: 'unavailable',
      reason: 'cache-error',
      bullets: [],
      sources: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
