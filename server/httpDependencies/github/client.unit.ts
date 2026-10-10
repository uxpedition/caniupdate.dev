import { Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { getGithubFile, listGithubDirectory, listGithubReleases } from './client';

const RELEASES_PER_PAGE = 100;

const MAX_BODY_BYTES = 1_048_576;

type RequestCapture = {
  method: string;
  url: string;
  accept: string | null;
  apiVersion: string | null;
  userAgent: string | null;
  authorization: string | null;
};

function runWithStub<T, E>(effect: Effect.Effect<T, E, HttpClient.HttpClient>, responses: Response[]) {
  const calls: RequestCapture[] = [];

  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);
      calls.push({
        method: request.method,
        url: request.url,
        accept: webRequest.headers.get('accept'),
        apiVersion: webRequest.headers.get('x-github-api-version'),
        userAgent: webRequest.headers.get('user-agent'),
        authorization: webRequest.headers.get('authorization'),
      });
      const response = responses.shift();

      if (response === undefined) {
        return yield* Effect.die(new Error('stub response queue exhausted'));
      }

      return HttpClientResponse.fromWeb(request, response);
    }),
  );

  return {
    calls,
    result: Effect.runPromise(effect.pipe(Effect.provideService(HttpClient.HttpClient, client))),
  };
}

const repository = { owner: 'octo-org', repo: 'release-tools' };

const release = (index: number) => ({
  tag_name: `v${index}.0.0`,
  name: index % 2 === 0 ? `Release ${index}` : null,
  body: index % 2 === 0 ? `Notes ${index}` : null,
  html_url: `https://github.com/${repository.owner}/${repository.repo}/releases/tag/v${index}.0.0`,
  draft: false,
  prerelease: false,
});

const fullReleasePage = (offset: number) =>
  Array.from({ length: RELEASES_PER_PAGE }, (_, index) => release(offset + index));

// oxlint-disable-next-line rules/no-unknown-parameters -- Transport stub returning arbitrary GitHub JSON; the client decodes every response.
const releasesResponse = (body: unknown, headers?: Record<string, string>) =>
  Response.json(body, { status: 200, headers });

const errorResponse = (status: number) => Response.json({ message: 'failure' }, { status });

describe('listGithubReleases', () => {
  it('requests the fixed releases endpoint with GitHub headers and completes an empty page', async () => {
    const { calls, result } = runWithStub(listGithubReleases(repository, 'ghp_secret'), [releasesResponse([])]);

    await expect(result).resolves.toEqual({ releases: [], complete: true });
    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'https://api.github.com/repos/octo-org/release-tools/releases?page=1&per_page=100',
        accept: 'application/vnd.github+json',
        apiVersion: '2022-11-28',
        userAgent: 'can-i-update',
        authorization: 'Bearer ghp_secret',
      },
    ]);
  });

  it('uses fixed numbered pages rather than a Link URL and stops on a short page', async () => {
    const firstPage = fullReleasePage(0);
    const secondPage = [release(100)];

    const { calls, result } = runWithStub(listGithubReleases(repository), [
      releasesResponse(firstPage, {
        link: '<https://evil.example/releases?page=2>; rel="next"',
      }),
      releasesResponse(secondPage),
    ]);

    const response = await result;

    expect(response.complete).toBe(true);
    expect(response.releases).toHaveLength(101);
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/octo-org/release-tools/releases?page=1&per_page=100',
      'https://api.github.com/repos/octo-org/release-tools/releases?page=2&per_page=100',
    ]);
  });

  it('retains releases and marks the result incomplete when a later page fails', async () => {
    const { calls, result } = runWithStub(listGithubReleases(repository), [
      releasesResponse(fullReleasePage(0), {
        link: '<https://evil.example/releases?page=2>; rel="next"',
      }),
      errorResponse(503),
    ]);

    await expect(result).resolves.toMatchObject({
      releases: fullReleasePage(0),
      complete: false,
    });
    expect(calls).toHaveLength(2);
  });

  it('does not request another page when a full page has no next relation', async () => {
    const { calls, result } = runWithStub(listGithubReleases(repository), [releasesResponse(fullReleasePage(0))]);

    await expect(result).resolves.toMatchObject({ releases: fullReleasePage(0), complete: true });
    expect(calls).toHaveLength(1);
  });

  it('stops after ten linked full pages and marks the bounded result incomplete', async () => {
    const tenPages = Array.from({ length: 10 }, (_, page) =>
      releasesResponse(fullReleasePage(page * RELEASES_PER_PAGE), {
        link: '<https://evil.example/releases?page=next>; rel="next"',
      }),
    );

    const { calls, result } = runWithStub(listGithubReleases(repository), tenPages);

    const response = await result;

    expect(response.complete).toBe(false);
    expect(response.releases).toHaveLength(10 * RELEASES_PER_PAGE);
    expect(calls).toHaveLength(10);
    expect(calls.at(-1)?.url).toBe('https://api.github.com/repos/octo-org/release-tools/releases?page=10&per_page=100');
  });

  it('rejects malformed release records instead of returning partial data', async () => {
    const { result } = runWithStub(listGithubReleases(repository), [releasesResponse([{ tag_name: 'v1.0.0' }])]);

    await expect(result).rejects.toMatchObject({ _tag: 'SchemaError' });
  });

  it('rejects redirects instead of following a token-bearing request', async () => {
    const { calls, result } = runWithStub(listGithubReleases(repository, 'ghp_secret'), [
      new Response('', { status: 302, headers: { location: 'https://evil.example/steal' } }),
    ]);

    await expect(result).rejects.toMatchObject({ _tag: 'HttpClientError' });
    expect(calls).toHaveLength(1);
  });
});

describe('listGithubDirectory', () => {
  it('lists an explicitly referenced encoded directory with JSON headers', async () => {
    const { calls, result } = runWithStub(listGithubDirectory(repository, 'docs/release notes', 'release/v1.2.3'), [
      releasesResponse([
        { name: 'CHANGELOG.md', path: 'docs/CHANGELOG.md', type: 'file' },
        { name: 'older', path: 'docs/older', type: 'dir' },
      ]),
    ]);

    await expect(result).resolves.toEqual([
      { name: 'CHANGELOG.md', path: 'docs/CHANGELOG.md', type: 'file' },
      { name: 'older', path: 'docs/older', type: 'dir' },
    ]);
    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/octo-org/release-tools/contents/docs/release%20notes?ref=release%2Fv1.2.3',
      accept: 'application/vnd.github+json',
      authorization: null,
    });
  });

  it('rejects a file object returned where a directory array was required', async () => {
    const { result } = runWithStub(listGithubDirectory(repository, '', 'v1.0.0'), [
      releasesResponse({ name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' }),
    ]);

    await expect(result).rejects.toMatchObject({ _tag: 'SchemaError' });
  });
});

describe('getGithubFile', () => {
  it('gets raw text at the encoded path and explicit ref without using the default branch', async () => {
    const { calls, result } = runWithStub(getGithubFile(repository, 'docs/CHANGELOG release.md', 'release/v1.2.3'), [
      new Response('# Release notes\n', { status: 200 }),
    ]);

    await expect(result).resolves.toBe('# Release notes\n');
    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/octo-org/release-tools/contents/docs/CHANGELOG%20release.md?ref=release%2Fv1.2.3',
      accept: 'application/vnd.github.raw+json',
      apiVersion: '2022-11-28',
      userAgent: 'can-i-update',
      authorization: null,
    });
  });

  it('rejects raw text whose UTF-8 body exceeds one MiB', async () => {
    const oversized = 'é'.repeat(Math.ceil((MAX_BODY_BYTES + 1) / 2));
    const { result } = runWithStub(getGithubFile(repository, 'CHANGELOG.md', 'v1.0.0'), [new Response(oversized)]);

    await expect(result).rejects.toMatchObject({ _tag: 'GithubResponseTooLargeError' });
  });

  it('rejects a declared oversized raw body before decoding it', async () => {
    const { result } = runWithStub(getGithubFile(repository, 'CHANGELOG.md', 'v1.0.0'), [
      new Response('not read', { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }),
    ]);

    await expect(result).rejects.toMatchObject({ _tag: 'GithubResponseTooLargeError' });
  });
});
