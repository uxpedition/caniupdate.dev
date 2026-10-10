import { Schema } from 'effect';

import { PackageNameSchema } from '#shared/comparison/package/package.defs';

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
