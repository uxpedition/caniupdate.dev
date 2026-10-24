import { createError, defineEventHandler, getValidatedRouterParams, setResponseHeader } from 'h3';

import { getPackageMetadata } from './compare/_internals/evidenceClient';
import { decodePackageComparisonRouterParams } from './compare/_internals/request';

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);

  try {
    return await getPackageMetadata(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, packageName);
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Package metadata temporarily unavailable. Try again later.',
    });
  }
});
