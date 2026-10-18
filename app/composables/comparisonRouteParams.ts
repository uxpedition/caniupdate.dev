import { Schema } from 'effect';

import { PackageNameSchema } from '#shared/comparison/package/package.defs';

const VersionPairSchema = Schema.String.check(
  Schema.makeFilter((pair) => {
    const parts = pair.split('...');

    return parts.length === 2 && parts.every((part) => part.trim().length > 0 && part.trim().length <= 256);
  }),
);

export const isComparisonRouteParams = Schema.is(
  Schema.Struct({ packageName: PackageNameSchema, versionPair: VersionPairSchema }),
);
