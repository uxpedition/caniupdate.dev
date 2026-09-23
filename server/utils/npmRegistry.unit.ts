import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { beforeEach, expect, it, vi } from 'vitest';

import { getRegistryJson } from './npmRegistry';

const INSTALL_V1_ACCEPT = 'application/vnd.npm.install-v1+json';

// `FetchHttpClient.Fetch` memoizes its `globalThis.fetch` default on the reference, so a global stub keeps serving
// whichever test touched it first. Providing the fetch implementation per run keeps every test on its own mock.
const fetchStub = vi.fn<typeof fetch>();

const run = (path: string, options?: Parameters<typeof getRegistryJson>[1]) =>
  Effect.runPromise(
    getRegistryJson(path, options).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetchStub),
    ),
  );

beforeEach(() => {
  fetchStub.mockReset();
});

it('encodes search text without creating extra query parameters', async () => {
  fetchStub.mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    expect(url.origin).toBe('https://registry.npmjs.org');
    expect(url.pathname).toBe('/-/v1/search');
    expect([...url.searchParams.keys()]).toEqual(['text', 'size']);
    expect(url.searchParams.get('text')).toBe('@scope/pkg & size=250');
    expect(url.searchParams.get('size')).toBe('20');
    return Response.json({ objects: [] });
  });
  await expect(run('/-/v1/search', { query: { text: '@scope/pkg & size=250', size: 20 } })).resolves.toEqual({
    objects: [],
  });
});

it('rejects an HTTP failure even when its body is valid JSON', async () => {
  fetchStub.mockResolvedValue(Response.json({ error: 'rate limited' }, { status: 429 }));
  await expect(run('/widget/1.0.0')).rejects.toBeDefined();
  expect(fetchStub).toHaveBeenCalledTimes(1);
});

it('rejects a successful response with malformed JSON', async () => {
  fetchStub.mockResolvedValue(new Response('{'));
  await expect(run('/widget/1.0.0')).rejects.toBeDefined();
  expect(fetchStub).toHaveBeenCalledTimes(1);
});

it('forwards the caller-supplied install-v1 accept header', async () => {
  const accepts: Array<string | null> = [];
  fetchStub.mockImplementation(async (input, init) => {
    accepts.push(new Headers(init?.headers).get('accept'));
    return Response.json({});
  });
  await expect(run('/widget', { accept: INSTALL_V1_ACCEPT })).resolves.toEqual({});
  expect(accepts).toEqual([INSTALL_V1_ACCEPT]);
});

it('preserves a once-encoded scoped package segment', async () => {
  fetchStub.mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    expect(url.origin).toBe('https://registry.npmjs.org');
    expect(url.pathname).toBe('/%40scope%2Fpkg/1.0.0');
    return Response.json({});
  });
  await expect(run(`/${encodeURIComponent('@scope/pkg')}/1.0.0`)).resolves.toEqual({});
});
