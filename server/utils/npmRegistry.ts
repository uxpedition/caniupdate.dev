import { Effect } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';

type RegistryJsonOptions = {
  query?: Readonly<Record<string, string | number>>;
  accept?: string;
};

/**
 * Reads JSON from the public npm registry.
 *
 * `path` always starts with `/` and is assembled by the caller, with package and version segments already
 * URL-encoded. The origin is fixed here, so no public input can point the request at another host.
 *
 * The transport reads no `.npmrc`, proxy environment variables, or registry credentials, and adds no retries: the
 * product only reads public registry metadata. The deadline matches the npm client's own request timeout.
 */
export const getRegistryJson = Effect.fn('Registry.getJson')(function* (
  path: string,
  options: RegistryJsonOptions = {},
) {
  const url = new URL(`https://registry.npmjs.org${path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, String(value));
  }
  let request = HttpClientRequest.get(url.href);
  if (options.accept !== undefined) {
    request = HttpClientRequest.setHeader(request, 'accept', options.accept);
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.pipe(HttpClient.filterStatusOk).execute(request);
  return yield* response.json;
}, Effect.timeout('5 minutes'));
