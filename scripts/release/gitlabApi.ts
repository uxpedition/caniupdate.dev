import { Effect, Schema } from 'effect';

import { ReleaseAutomationFailure } from './version.ts';

export const GITLAB_PROJECT_ID = '86537464';

const GITLAB_PROJECT_API = `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT_ID}`;

const REQUEST_TIMEOUT_MS = 15_000;

export interface GitLabClient {
  request(path: string, allowMissing?: boolean): Effect.Effect<unknown, ReleaseAutomationFailure>;
  listPages(path: string): Effect.Effect<readonly unknown[], ReleaseAutomationFailure>;
}

type GitLabResponse = { readonly value: unknown; readonly headers: Headers };

export class GitLabApiClient implements GitLabClient {
  private readonly token: string;
  private readonly requestFetch: typeof fetch;

  constructor(token: string, requestFetch: typeof fetch = fetch) {
    this.token = token;
    this.requestFetch = requestFetch;
  }

  private requestResponse(url: URL, allowMissing = false): Effect.Effect<GitLabResponse, ReleaseAutomationFailure> {
    const requestFetch = this.requestFetch;
    const token = this.token;

    return Effect.gen(function* () {
      if (token.trim() === '') {
        return yield* Effect.fail(new ReleaseAutomationFailure('GitLab release API credential is missing'));
      }

      const headers = yield* Effect.try({
        try: () => new Headers({ 'PRIVATE-TOKEN': token, Accept: 'application/json' }),
        catch: () => new ReleaseAutomationFailure('GitLab API request could not be prepared'),
      });
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          requestFetch(url, {
            method: 'GET',
            headers,
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          }),
        catch: () => new ReleaseAutomationFailure('GitLab API request failed before a response was received'),
      });

      if (allowMissing && response.status === 404) return { value: null, headers: response.headers };

      if (!response.ok) {
        return yield* Effect.fail(
          new ReleaseAutomationFailure(`GitLab API request failed with HTTP ${response.status}`),
        );
      }

      const value: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new ReleaseAutomationFailure('GitLab API returned an unreadable response'),
      });

      return { value, headers: response.headers };
    });
  }

  request(path: string, allowMissing = false): Effect.Effect<unknown, ReleaseAutomationFailure> {
    if (!path.startsWith('/')) {
      return Effect.fail(new ReleaseAutomationFailure('GitLab API path is invalid'));
    }

    return Effect.try({
      try: () => new URL(`${GITLAB_PROJECT_API}${path}`),
      catch: () => new ReleaseAutomationFailure('GitLab API path is invalid'),
    }).pipe(
      Effect.flatMap((url) => this.requestResponse(url, allowMissing)),
      Effect.map(({ value }) => value),
    );
  }

  listPages(path: string): Effect.Effect<readonly unknown[], ReleaseAutomationFailure> {
    if (!path.startsWith('/')) {
      return Effect.fail(new ReleaseAutomationFailure('GitLab API path is invalid'));
    }

    const client = this;

    return Effect.gen(function* () {
      const endpoint = yield* Effect.try({
        try: () => new URL(`${GITLAB_PROJECT_API}${path}`),
        catch: () => new ReleaseAutomationFailure('GitLab API path is invalid'),
      });
      const rows: unknown[] = [];

      for (let page = 1; page <= 20; page += 1) {
        endpoint.searchParams.set('per_page', '100');
        endpoint.searchParams.set('page', String(page));

        const response = yield* client.requestResponse(endpoint);

        const pageRows = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))(response.value).pipe(
          Effect.mapError(() => new ReleaseAutomationFailure('GitLab API returned an invalid paginated response')),
        );

        rows.push(...pageRows);

        if (response.headers.get('x-next-page') === null || response.headers.get('x-next-page') === '') return rows;
      }

      return yield* Effect.fail(
        new ReleaseAutomationFailure('GitLab API pagination exceeded the release safety limit'),
      );
    });
  }
}
