import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { GitLabApiClient } from './gitlabApi.ts';
import { ReleaseAutomationFailure } from './version.ts';

describe('GitLab read-only API adapter', () => {
  it('decodes each response page and stops when GitLab has no next page', async () => {
    const requestedPages: string[] = [];

    const api = new GitLabApiClient('fixture-token', async (input) => {
      if (!(input instanceof URL)) throw new Error('GitLab API must pass a URL to fetch');

      const page = input.searchParams.get('page') ?? '';
      requestedPages.push(page);

      return new Response(JSON.stringify([{ page: Number(page) }]), {
        headers: { 'x-next-page': page === '1' ? '2' : '' },
      });
    });

    await expect(Effect.runPromise(api.listPages('/repository/tags'))).resolves.toEqual([{ page: 1 }, { page: 2 }]);
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('rejects non-array page data through the typed release failure channel', async () => {
    const api = new GitLabApiClient(
      'fixture-token',
      async () => new Response(JSON.stringify({ data: [] }), { headers: { 'x-next-page': '' } }),
    );

    await expect(Effect.runPromise(api.listPages('/repository/tags'))).rejects.toMatchObject({
      message: 'GitLab API returned an invalid paginated response',
    });
  });

  it('caps paginated GitLab evidence at the release safety limit', async () => {
    const requestedPages: string[] = [];

    const api = new GitLabApiClient('fixture-token', async (input) => {
      if (!(input instanceof URL)) throw new Error('GitLab API must pass a URL to fetch');

      requestedPages.push(input.searchParams.get('page') ?? '');

      return new Response('[]', { headers: { 'x-next-page': '1' } });
    });

    await expect(Effect.runPromise(api.listPages('/repository/tags'))).rejects.toMatchObject({
      message: 'GitLab API pagination exceeded the release safety limit',
    });
    expect(requestedPages).toHaveLength(20);
  });

  it('uses only authenticated GET requests for verified repository evidence', async () => {
    const requests: { readonly method: string | undefined; readonly token: string | null; readonly path: string }[] =
      [];

    const api = new GitLabApiClient('fixture-token', async (input, init) => {
      if (!(input instanceof URL)) throw new Error('GitLab API must pass a URL to fetch');

      requests.push({
        method: init?.method,
        token: new Headers(init?.headers).get('PRIVATE-TOKEN'),
        path: input.pathname,
      });

      return new Response(JSON.stringify({ name: 'main' }));
    });

    await expect(Effect.runPromise(api.request('/repository/branches/main'))).resolves.toEqual({ name: 'main' });
    expect(requests).toEqual([
      {
        method: 'GET',
        token: 'fixture-token',
        path: '/api/v4/projects/86537464/repository/branches/main',
      },
    ]);
  });

  it('returns null only for an explicitly optional missing resource', async () => {
    const api = new GitLabApiClient('fixture-token', async () => new Response('', { status: 404 }));

    await expect(Effect.runPromise(api.request('/repository/tags/v1.2.3', true))).resolves.toBeNull();
    await expect(Effect.runPromise(api.request('/repository/tags/v1.2.3'))).rejects.toBeInstanceOf(
      ReleaseAutomationFailure,
    );
  });

  it('maps failed HTTP requests to a sanitized release failure', async () => {
    const api = new GitLabApiClient('fixture-token', async () => {
      throw new Error('fixture-private-response-token');
    });

    const failure: unknown = await Effect.runPromise(api.request('/repository/branches/main')).catch(
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(ReleaseAutomationFailure);
    expect(failure).toMatchObject({ message: 'GitLab API request failed before a response was received' });
    expect(String(failure)).not.toContain('fixture-private-response-token');
  });

  it('keeps malformed JSON in the unreadable-response failure category', async () => {
    const api = new GitLabApiClient('fixture-token', async () => new Response('{private-invalid-json'));
    const result = Effect.runPromise(api.request('/repository/branches/main'));

    await expect(result).rejects.toMatchObject({ message: 'GitLab API returned an unreadable response' });
    await expect(result).rejects.toBeInstanceOf(ReleaseAutomationFailure);
  });

  it.each(['null', 'false', '42', '1e400', '"text"', '{"extra":[null,true,{"name":"main"},1e400]}'])(
    'keeps valid JSON %s available for the owning domain decoder',
    async (contents) => {
      const api = new GitLabApiClient('fixture-token', async () => new Response(contents));

      await expect(Effect.runPromise(api.request('/repository/branches/main'))).resolves.toEqual(JSON.parse(contents));
    },
  );

  it('rejects invalid API paths before making a request', async () => {
    let fetched = false;

    const api = new GitLabApiClient('fixture-token', async () => {
      fetched = true;

      return new Response('{}');
    });

    await expect(Effect.runPromise(api.request('repository/branches/main'))).rejects.toBeInstanceOf(
      ReleaseAutomationFailure,
    );
    expect(fetched).toBe(false);
  });
});
