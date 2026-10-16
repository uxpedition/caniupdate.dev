import { Schema } from 'effect';
import { getValidatedQuery, getValidatedRouterParams, type H3Event } from 'h3';

import { PackageNameSchema } from '#shared/comparison/package/package.defs';

import type { PackageEvidenceRequest } from './evidenceClient';

const VERSION_MAX_LENGTH = 256;

const VersionQueryParamSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));

export const PackageComparisonQuerySchema = Schema.Struct({
  from: VersionQueryParamSchema,
  to: VersionQueryParamSchema,
});

export const PackageComparisonRouterParamsSchema = Schema.Struct({
  packageName: Schema.StringFromUriComponent.pipe(Schema.decodeTo(PackageNameSchema)),
});

export const decodePackageComparisonRouterParams = Schema.decodeUnknownSync(PackageComparisonRouterParamsSchema, {
  errors: 'all',
});

export const decodePackageComparisonQuery = Schema.decodeUnknownSync(PackageComparisonQuerySchema, { errors: 'all' });

export const readComparisonRequest = async (event: H3Event): Promise<PackageEvidenceRequest> => {
  const { packageName } = await getValidatedRouterParams(event, decodePackageComparisonRouterParams);
  const { from, to } = await getValidatedQuery(event, decodePackageComparisonQuery);

  return { packageName, from, to };
};
