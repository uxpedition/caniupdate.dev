import { Duration, Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

import {
  OsvQueryBatchRequestSchema,
  OsvQueryBatchResponseSchema,
  OsvVulnerabilitySchema,
  type OsvQueryBatchRequest,
} from '../../../shared/comparison/evidence/osv.defs';

const API_ORIGIN = 'https://api.osv.dev';
const REQUEST_TIMEOUT = Duration.seconds(5);

/** Queries one OSV batch page; results and continuation tokens retain input order. */
export const queryBatch = Effect.fn('Osv.queryBatch')(function* (body: OsvQueryBatchRequest) {
  const client = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.post(`${API_ORIGIN}/v1/querybatch`).pipe(
    HttpClientRequest.schemaBodyJson(OsvQueryBatchRequestSchema)(body),
  );
  const response = yield* client.pipe(HttpClient.filterStatusOk).execute(request);
  return yield* HttpClientResponse.schemaBodyJson(OsvQueryBatchResponseSchema)(response);
}, Effect.timeout(REQUEST_TIMEOUT));

/** Fetches one advisory record, failing rather than returning an empty record for unknown ids. */
export const getVulnerability = Effect.fn('Osv.getVulnerability')(function* (id: string) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(`${API_ORIGIN}/v1/vulns/${encodeURIComponent(id)}`);
  const response = yield* client.pipe(HttpClient.filterStatusOk).execute(request);
  return yield* HttpClientResponse.schemaBodyJson(OsvVulnerabilitySchema)(response);
}, Effect.timeout(REQUEST_TIMEOUT));
