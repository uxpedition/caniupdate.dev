import { Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http';

import { BundlephobiaBuildSchema } from '../../shared/bundlephobia.defs';

export const bundlephobiaSizeUrl = (packageName: string, version: string) =>
  `https://bundlephobia.com/api/size?package=${encodeURIComponent(`${packageName}@${version}`)}`;

/** Includes response decoding in the deadline; no retries for rate-limited or failed builds. */
export const getBundlephobiaSize = Effect.fn('Bundlephobia.getSize')(function* (packageName: string, version: string) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(bundlephobiaSizeUrl(packageName, version));
  const response = yield* client.pipe(HttpClient.filterStatusOk).execute(request);
  return yield* HttpClientResponse.schemaBodyJson(BundlephobiaBuildSchema)(response);
}, Effect.timeout('30 seconds'));
