import { Data, Duration, Effect, Option, Result, Schema } from 'effect';
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

const API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_USER_AGENT = 'can-i-update';
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;
const REQUEST_TIMEOUT = Duration.seconds(5);
const MAX_BODY_BYTES = 1_048_576;

export type GithubRepository = {
  readonly owner: string;
  readonly repo: string;
};

export type GithubRelease = {
  readonly tag_name: string;
  readonly name: string | null;
  readonly body: string | null;
  readonly html_url: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
};

export type GithubEntry = {
  readonly name: string;
  readonly path: string;
  readonly type: string;
};

const GithubReleaseSchema = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.NullOr(Schema.String),
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
});

const GithubReleasePageSchema = Schema.Array(GithubReleaseSchema);

const GithubEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.String,
});

const GithubDirectorySchema = Schema.Array(GithubEntrySchema);

const GithubResponseTooLargeError = Data.TaggedError('GithubResponseTooLargeError')<{
  readonly actual: number;
  readonly limit: number;
}>;

const GithubResponseDecodeError = Data.TaggedError('GithubResponseDecodeError')<{
  readonly cause: unknown;
}>;

const encodePathSegment = (segment: string): string => {
  const encoded = encodeURIComponent(segment);
  return segment === '.' || segment === '..' ? encoded.replaceAll('.', '%2E') : encoded;
};

const encodePath = (path: string): string => path.split('/').map(encodePathSegment).join('/');

const repositoryPath = (repository: GithubRepository): string =>
  `/repos/${encodePathSegment(repository.owner)}/${encodePathSegment(repository.repo)}`;

const releasesUrl = (repository: GithubRepository, page: number): string =>
  `${API_ORIGIN}${repositoryPath(repository)}/releases?page=${page}&per_page=${RELEASES_PER_PAGE}`;

const contentsUrl = (repository: GithubRepository, path: string, ref: string): string =>
  `${API_ORIGIN}${repositoryPath(repository)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;

const githubRequest = (url: string, accept: string, token?: string): HttpClientRequest.HttpClientRequest => {
  const request = HttpClientRequest.get(url, {
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': GITHUB_USER_AGENT,
    },
  });

  return token === undefined || token.length === 0 ? request : HttpClientRequest.bearerToken(request, token);
};

const executeGithubRequest = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, unknown> =>
  Effect.gen(function* () {
    const noRedirectClient = client.pipe(HttpClient.followRedirects(0));
    return yield* noRedirectClient.pipe(HttpClient.filterStatusOk).execute(request);
  }).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }));

const hasNextPage = (response: HttpClientResponse.HttpClientResponse): boolean => {
  const link = Option.getOrUndefined(Headers.get(response.headers, 'link'));
  if (link === undefined) return false;

  return link.split(',').some((part) => /;\s*rel\s*=\s*(?:"next"|'next'|next)(?:\s*;|\s*$)/i.test(part));
};

const contentLength = (response: HttpClientResponse.HttpClientResponse): number | undefined => {
  const value = Option.getOrUndefined(Headers.get(response.headers, 'content-length'));
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return !Number.isNaN(parsed) && parsed >= 0 ? parsed : undefined;
};

const readResponseBody = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<ArrayBuffer, unknown> =>
  Effect.gen(function* () {
    const declaredLength = contentLength(response);
    if (declaredLength !== undefined && declaredLength > MAX_BODY_BYTES) {
      return yield* Effect.fail(new GithubResponseTooLargeError({ actual: declaredLength, limit: MAX_BODY_BYTES }));
    }

    const body = yield* response.arrayBuffer;
    if (body.byteLength > MAX_BODY_BYTES) {
      return yield* Effect.fail(new GithubResponseTooLargeError({ actual: body.byteLength, limit: MAX_BODY_BYTES }));
    }
    return body;
  });

const readResponseText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string, unknown> =>
  Effect.map(readResponseBody(response), (body) => new TextDecoder().decode(body));

const readResponseJson = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<unknown, unknown> =>
  Effect.gen(function* () {
    const text = yield* readResponseText(response);
    return yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: (cause) => new GithubResponseDecodeError({ cause }),
    });
  });

const fetchReleasePage = (
  client: HttpClient.HttpClient,
  repository: GithubRepository,
  page: number,
  token?: string,
): Effect.Effect<{ readonly releases: readonly GithubRelease[]; readonly hasNext: boolean }, unknown> =>
  Effect.gen(function* () {
    const response = yield* executeGithubRequest(
      client,
      githubRequest(releasesUrl(repository, page), 'application/vnd.github+json', token),
    );
    const body = yield* readResponseJson(response);
    const releases = yield* Schema.decodeUnknownEffect(GithubReleasePageSchema)(body, { errors: 'all' });
    return { releases, hasNext: hasNextPage(response) };
  }).pipe(Effect.timeout(REQUEST_TIMEOUT));

export const listGithubReleases = Effect.fn('Github.listGithubReleases')(function* (
  repository: GithubRepository,
  token?: string,
) {
  const client = yield* HttpClient.HttpClient;
  const releases: GithubRelease[] = [];
  const firstPage = yield* fetchReleasePage(client, repository, 1, token);
  releases.push(...firstPage.releases);

  if (!firstPage.hasNext) {
    return { releases, complete: true };
  }

  for (let page = 2; page <= MAX_RELEASE_PAGES; page += 1) {
    const nextPage = yield* fetchReleasePage(client, repository, page, token).pipe(Effect.result);

    if (Result.isFailure(nextPage)) {
      return { releases, complete: false };
    }

    releases.push(...nextPage.success.releases);
    if (!nextPage.success.hasNext) {
      return { releases, complete: true };
    }
  }

  return { releases, complete: false };
});

export const listGithubDirectory = Effect.fn('Github.listGithubDirectory')(function* (
  repository: GithubRepository,
  path: string,
  ref: string,
  token?: string,
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* executeGithubRequest(
    client,
    githubRequest(contentsUrl(repository, path, ref), 'application/vnd.github+json', token),
  );
  const body = yield* readResponseJson(response);
  return yield* Schema.decodeUnknownEffect(GithubDirectorySchema)(body, { errors: 'all' });
}, Effect.timeout(REQUEST_TIMEOUT));

export const getGithubFile = Effect.fn('Github.getGithubFile')(function* (
  repository: GithubRepository,
  path: string,
  ref: string,
  token?: string,
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* executeGithubRequest(
    client,
    githubRequest(contentsUrl(repository, path, ref), 'application/vnd.github.raw+json', token),
  );
  return yield* readResponseText(response);
}, Effect.timeout(REQUEST_TIMEOUT));
