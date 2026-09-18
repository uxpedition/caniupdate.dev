import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefingInput } from '#shared/briefing.defs';
import type { ComparisonVersion, PackageComparison } from '#shared/comparison.defs';
import type { PackageReleaseNotes } from '#shared/github.defs';

import { getPackageBriefing } from './packageBriefing';

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
  { kind: 'change', basis: 'fact', text: 'The Node declaration changed.', evidenceIds: ['comparison.node'] },
  {
    kind: 'migration',
    basis: 'inference',
    text: 'Check the deployment runtime against the target declaration.',
    evidenceIds: ['comparison.node'],
  },
  {
    kind: 'coverage',
    basis: 'fact',
    text: 'This comparison does not test the package in your application.',
    evidenceIds: ['coverage'],
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
  beforeEach(() => {
    vi.stubEnv('AI_BRIEFING_ENDPOINT', 'https://briefing.example/v1/chat/completions');
    vi.stubEnv('AI_BRIEFING_API_KEY', 'test-key');
    vi.stubEnv('AI_BRIEFING_MODEL', 'test-model');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns cited sources for a valid response and never trusts model URLs', async () => {
    fetchMock.mockResolvedValue(response());
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

  it('rejects a truncated provider response', async () => {
    fetchMock.mockResolvedValue(response(undefined, 'length'));

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

  it('rejects unknown citations without exposing the provider response', async () => {
    fetchMock.mockResolvedValue(
      response([
        { kind: 'change', basis: 'fact', text: 'Unknown.', evidenceIds: ['invented'] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceIds: ['comparison.node'] },
        { kind: 'coverage', basis: 'fact', text: 'Coverage is limited.', evidenceIds: ['coverage'] },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-response',
      bullets: [],
      sources: [],
    });
  });

  it('rejects an oversized chunked provider response before collecting it', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        { kind: 'coverage', basis: 'fact', text: 'Coverage is limited.', evidenceIds: ['coverage'] },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'invalid-response' });
  });

  it('allows ordinary colon labels in cited prose', async () => {
    fetchMock.mockResolvedValue(
      response([
        { kind: 'change', basis: 'fact', text: 'Node: use the target declaration.', evidenceIds: ['comparison.node'] },
        { kind: 'migration', basis: 'inference', text: 'Check the target.', evidenceIds: ['comparison.node'] },
        { kind: 'coverage', basis: 'fact', text: 'Coverage is limited.', evidenceIds: ['coverage'] },
      ]),
    );

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'available' });
  });

  it('does not retry provider failures', async () => {
    fetchMock.mockResolvedValue(new Response('provider failure', { status: 503 }));

    await expect(runBriefing(input())).resolves.toMatchObject({ status: 'unavailable', reason: 'provider-error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request for an identical evidence/configuration snapshot', async () => {
    const gate = Promise.withResolvers<Response>();
    fetchMock.mockImplementation(() => gate.promise);
    const value = input();

    const first = runBriefing(value);
    const second = runBriefing(value);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    gate.resolve(response());

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
  });

  it('invalidates a successful entry when evidence or configuration changes', async () => {
    fetchMock.mockImplementation(async () => response());
    const value = input();

    await expect(runBriefing(value)).resolves.toMatchObject({ status: 'available' });
    const changedEvidence = { ...value, comparison: comparison('>=22') };
    await expect(runBriefing(changedEvidence)).resolves.toMatchObject({ status: 'available' });
    vi.stubEnv('AI_BRIEFING_MODEL', 'changed-model');
    await expect(runBriefing(value)).resolves.toMatchObject({ status: 'available', model: 'changed-model' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
