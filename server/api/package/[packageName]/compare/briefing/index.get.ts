import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import { decodePackageComparisonQuery, decodePackageComparisonRouterParams } from '../_internals/request';
import { getStoredBriefing } from './_internals/storedBriefing';

export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);

  return getStoredBriefing(event, { packageName, from, to });
});
