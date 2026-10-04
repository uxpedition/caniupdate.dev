import { createError, defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import {
  decodePackageComparisonQuery,
  decodePackageComparisonRouterParams,
} from '../../../../../utils/packageComparisonFacts';
import { getPackageMeasurements, PackageEvidenceClientError } from '../_internals/evidenceClient';

// Sizes, advisories, and inspected-archive summaries are collected by the private package object so a public request
// never performs archive/provider work in the Nuxt Worker.
export default defineEventHandler(async (event) => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);
  try {
    return await getPackageMeasurements(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, { packageName, from, to });
  } catch (error) {
    if (error instanceof PackageEvidenceClientError) {
      throw createError({ statusCode: 503, statusMessage: 'Evidence service unavailable' });
    }
    throw error;
  }
});
