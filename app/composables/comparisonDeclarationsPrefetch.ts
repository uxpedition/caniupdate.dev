import type { QueryClient } from '@tanstack/vue-query';
import { Schema } from 'effect';

import type { PackageComparisonQueryOptions } from './packageComparisonQueryOptions';

const isIdentityOrAdmissionError = Schema.is(Schema.Struct({ statusCode: Schema.Literals([400, 404, 429]) }));

/** Failed server queries are removed so the browser can recover rather than hydrate an error. */
export const prefetchDeclarations = async (
  queryClient: QueryClient,
  declarationsOptions: PackageComparisonQueryOptions,
): Promise<400 | 404 | 429 | 503 | undefined> => {
  let failureStatus: 400 | 404 | 429 | 503 | undefined;

  await queryClient.query(declarationsOptions).catch((cause: unknown) => {
    failureStatus = isIdentityOrAdmissionError(cause) ? cause.statusCode : 503;
  });

  if (queryClient.getQueryState(declarationsOptions.queryKey)?.status !== 'success') {
    queryClient.removeQueries({ queryKey: declarationsOptions.queryKey });
  }

  return failureStatus;
};
