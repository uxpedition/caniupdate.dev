import { Effect } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { getPackageReleaseNotes } from './releaseNotes';

type ManifestOptions = {
  repository?: string | { type?: string; url: string; directory?: string } | null;
  gitHead?: string;
};

type TestManifest = {
  name: string;
  version: string;
  dist: { tarball: string; shasum: string };
  repository?: string | { type?: string; url: string; directory?: string } | null;
  gitHead?: string;
};

const manifest = (version: string, options: ManifestOptions = {}): TestManifest => ({
  name: 'widget',
  version,
  dist: { tarball: `https://registry.npmjs.org/widget/-/widget-${version}.tgz`, shasum: 'abc' },
  ...options,
});

const release = (tag: string, options: Partial<Record<'name' | 'body' | 'draft' | 'prerelease', unknown>> = {}) => ({
  tag_name: tag,
  name: options.name === undefined ? tag : options.name,
  body: options.body === undefined ? `Notes for ${tag}` : options.body,
  html_url: `https://github.com/acme/widgets/releases/tag/${encodeURIComponent(tag)}`,
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? false,
});

function run(
  from: ReturnType<typeof manifest>,
  to: ReturnType<typeof manifest>,
  responses: (request: Request) => Response,
  packageName = 'widget',
) {
  const calls: string[] = [];

  const client = HttpClient.make((request) => {
    calls.push(request.url);

    return Effect.succeed(
      HttpClientResponse.fromWeb(request, responses(new Request(request.url, { method: request.method }))),
    );
  });

  return {
    calls,
    result: Effect.runPromise(
      getPackageReleaseNotes(packageName, from, to).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    ),
  };
}

function releaseAndChangelogResponses(releases: unknown, changelog: string | Response = '# Changelog\n') {
  return (request: Request) => {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/releases')) return Response.json(releases);

    if (url.pathname === '/contents' || url.pathname.includes('/contents/')) {
      if (url.pathname.endsWith('/CHANGELOG.md') || url.pathname.endsWith('/changelog.md')) {
        return changelog instanceof Response ? changelog : new Response(changelog);
      }

      const directory = url.pathname.split('/contents/')[1] ?? '';

      return Response.json([
        { name: 'CHANGELOG.md', path: `${directory ? `${directory}/` : ''}CHANGELOG.md`, type: 'file' },
      ]);
    }

    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
}

describe('getPackageReleaseNotes', () => {
  it('matches the semver interval, keeps prereleases, excludes drafts, and reads a gitHead-pinned changelog', async () => {
    const { calls, result } = run(
      manifest('1.0.0', {
        repository: { type: 'git', url: 'git+https://github.com/Acme/Widgets.git' },
      }),
      manifest('1.2.0', {
        repository: { type: 'git', url: 'ssh://git@github.com/acme/widgets.git' },
        gitHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
      releaseAndChangelogResponses([
        release('v1.0.0'),
        release('v1.1.0', { name: null, body: 'A\nfull\nbody' }),
        release('v1.2.0-beta.1', { prerelease: true }),
        release('v1.2.0', { draft: true }),
        release('v1.3.0'),
      ]),
    );

    await expect(result).resolves.toEqual({
      status: 'available',
      reasons: [],
      releases: [
        {
          version: '1.1.0',
          tag: 'v1.1.0',
          name: null,
          body: 'A\nfull\nbody',
          url: 'https://github.com/acme/widgets/releases/tag/v1.1.0',
        },
        {
          version: '1.2.0-beta.1',
          tag: 'v1.2.0-beta.1',
          name: 'v1.2.0-beta.1',
          body: 'Notes for v1.2.0-beta.1',
          url: 'https://github.com/acme/widgets/releases/tag/v1.2.0-beta.1',
        },
      ],
      changelog: {
        body: '# Changelog\n',
        url: 'https://github.com/acme/widgets/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/CHANGELOG.md',
        path: 'CHANGELOG.md',
        ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls.some((url) => url.includes('/repos/acme/widgets/releases'))).toBe(true);
    expect(
      calls
        .filter((url) => url.includes('/contents/'))
        .every((url) => url.includes('ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    ).toBe(true);
  });

  it('requires package-specific release tags and never substitutes a repository changelog for a monorepo package', async () => {
    const packageName = '@scope/widget';

    const { calls, result } = run(
      manifest('1.0.0', {
        repository: { url: 'github:acme/widgets', directory: 'packages/widget' },
      }),
      manifest('1.2.0', {
        repository: { type: 'git', url: 'https://github.com/acme/widgets.git', directory: 'packages/widget' },
        gitHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
      releaseAndChangelogResponses([release('v1.1.0'), release('@scope/widget@1.1.0'), release('@scope/widget@1.2.0')]),
      packageName,
    );

    await expect(result).resolves.toMatchObject({
      status: 'available',
      releases: [
        { version: '1.1.0', tag: '@scope/widget@1.1.0' },
        { version: '1.2.0', tag: '@scope/widget@1.2.0' },
      ],
      changelog: {
        path: 'packages/widget/CHANGELOG.md',
        ref: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    expect(
      calls.some((url) => url.includes('/contents/packages/widget?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    ).toBe(true);
    expect(calls.some((url) => url.includes('/contents/CHANGELOG.md?'))).toBe(false);
  });

  it('uses a uniquely matching target release tag as the changelog ref when gitHead is absent', async () => {
    const { calls, result } = run(
      manifest('1.0.0', { repository: 'owner/widgets' }),
      manifest('1.1.0', { repository: 'git://github.com/owner/widgets.git' }),
      releaseAndChangelogResponses([release('1.1.0')]),
    );

    await expect(result).resolves.toMatchObject({
      status: 'available',
      releases: [{ version: '1.1.0', tag: '1.1.0' }],
      changelog: { ref: '1.1.0', path: 'CHANGELOG.md' },
    });
    expect(calls.some((url) => url.includes('/contents/?ref=1.1.0'))).toBe(true);
    expect(calls.some((url) => url.includes('/contents/CHANGELOG.md?ref=1.1.0'))).toBe(true);
  });

  it('uses a bare monorepo target tag only for a changelog verified by the package manifest at that tag', async () => {
    const repository = { url: 'https://github.com/acme/widgets', directory: 'packages/widget' };
    const responses = releaseAndChangelogResponses([release('v1.1.0')], '## 1.1.0\nUse the new adapter.');

    const { result } = run(manifest('1.0.0', { repository }), manifest('1.1.0', { repository }), (request) => {
      const url = new URL(request.url);

      if (url.pathname.includes('/contents/') && url.searchParams.get('ref') !== 'v1.1.0') {
        return new Response('unpinned request', { status: 400 });
      }

      if (url.pathname.endsWith('/contents/packages/widget/package.json')) {
        return Response.json({ name: 'widget', version: '1.1.0' });
      }

      return responses(request);
    });

    await expect(result).resolves.toMatchObject({
      status: 'partial',
      releases: [],
      changelog: { path: 'packages/widget/CHANGELOG.md', ref: 'v1.1.0', body: '## 1.1.0\nUse the new adapter.' },
    });
  });

  it.each([
    ['another package', JSON.stringify({ name: 'other', version: '1.1.0' }), 200],
    ['another version', JSON.stringify({ name: 'widget', version: '1.0.0' }), 200],
    ['malformed JSON', '{', 200],
    ['unavailable manifest', 'unavailable', 503],
  ])('does not attribute a monorepo changelog with %s at the target tag', async (_label, body, status) => {
    const repository = { url: 'https://github.com/acme/widgets', directory: 'packages/widget' };
    const responses = releaseAndChangelogResponses([release('v1.1.0')], 'Unrelated changes.');

    const { result } = run(manifest('1.0.0', { repository }), manifest('1.1.0', { repository }), (request) =>
      new URL(request.url).pathname.endsWith('/package.json') ? new Response(body, { status }) : responses(request),
    );

    await expect(result).resolves.toMatchObject({ status: 'partial', releases: [], changelog: null });
  });

  it('does not choose between ambiguous bare target tags in a monorepo', async () => {
    const repository = { url: 'https://github.com/acme/widgets', directory: 'packages/widget' };
    const responses = releaseAndChangelogResponses([release('v1.1.0'), release('1.1.0')], 'Ambiguous changes.');

    const { result } = run(manifest('1.0.0', { repository }), manifest('1.1.0', { repository }), (request) =>
      new URL(request.url).pathname.endsWith('/package.json')
        ? Response.json({ name: 'widget', version: '1.1.0' })
        : responses(request),
    );

    await expect(result).resolves.toMatchObject({ status: 'partial', releases: [], changelog: null });
  });

  it('returns unavailable without making GitHub calls for unsupported hosts or mismatched repositories', async () => {
    const noCalls = () => new Response('unexpected', { status: 500 });

    const unsupported = run(
      manifest('1.0.0', { repository: 'https://gitlab.com/acme/widgets.git' }),
      manifest('1.1.0', { repository: 'https://gitlab.com/acme/widgets.git' }),
      noCalls,
    );

    await expect(unsupported.result).resolves.toMatchObject({ status: 'unavailable', releases: [], changelog: null });
    expect(unsupported.calls).toEqual([]);
    expect((await unsupported.result).reasons.join(' ')).toMatch(/unsupported/i);

    const mismatched = run(
      manifest('1.0.0', { repository: 'https://github.com/acme/widgets.git' }),
      manifest('1.1.0', { repository: 'https://github.com/acme/other.git' }),
      noCalls,
    );

    await expect(mismatched.result).resolves.toMatchObject({ status: 'unavailable', releases: [], changelog: null });
    expect(mismatched.calls).toEqual([]);
  });

  it('isolates changelog failures and reports truncated release pagination as partial evidence', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => release(index === 0 ? '1.1.0' : `2.${index}.0`));

    const { calls, result } = run(
      manifest('1.0.0', {
        repository: 'https://github.com/acme/widgets',
        gitHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
      manifest('1.1.0', {
        repository: 'https://github.com/acme/widgets',
        gitHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
      (request) => {
        const url = new URL(request.url);

        if (url.pathname.endsWith('/releases')) {
          return url.searchParams.get('page') === '1'
            ? Response.json(firstPage, {
                headers: {
                  link: '<https://api.github.com/repos/acme/widgets/releases?page=2&per_page=100>; rel="next"',
                },
              })
            : Response.json({ message: 'rate limited' }, { status: 429 });
        }

        if (url.pathname.endsWith('/CHANGELOG.md')) return new Response('unavailable', { status: 503 });

        return Response.json([{ name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' }]);
      },
    );

    await expect(result).resolves.toMatchObject({
      status: 'partial',
      releases: [{ version: '1.1.0', tag: '1.1.0' }],
      changelog: null,
    });
    expect((await result).reasons.join(' ')).toMatch(/pagination|changelog|request/i);
    expect(calls.filter((url) => url.includes('/releases'))).toHaveLength(2);
  });

  it('rejects traversal directories and unsafe refs before requesting GitHub', async () => {
    const traversal = run(
      manifest('1.0.0', { repository: { url: 'https://github.com/acme/widgets', directory: 'packages/../widget' } }),
      manifest('1.1.0', {
        repository: { url: 'https://github.com/acme/widgets', directory: 'packages/../widget' },
        gitHead: 'safe',
      }),
      () => new Response('unexpected', { status: 500 }),
    );

    await expect(traversal.result).resolves.toMatchObject({ status: 'unavailable', releases: [], changelog: null });
    expect(traversal.calls).toEqual([]);
    expect((await traversal.result).reasons.join(' ')).toMatch(/traversal|unsafe/i);

    const unsafeRef = run(
      manifest('1.0.0', { repository: 'https://github.com/acme/widgets' }),
      manifest('1.1.0', { repository: 'https://github.com/acme/widgets', gitHead: 'release/../main' }),
      () => new Response('unexpected', { status: 500 }),
    );

    await expect(unsafeRef.result).resolves.toMatchObject({ status: 'unavailable', releases: [], changelog: null });
    expect(unsafeRef.calls.filter((url) => url.includes('/releases'))).toHaveLength(1);
    expect(unsafeRef.calls.some((url) => url.includes('/contents/'))).toBe(false);
    expect((await unsafeRef.result).reasons.join(' ')).toMatch(/unsafe|pinned/i);
  });
});
