import { Schema } from 'effect';

const BytesSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const BundlephobiaBuildSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  size: BytesSchema,
  gzip: BytesSchema,
  dependencyCount: Schema.optionalKey(BytesSchema),
  hasSideEffects: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Array(Schema.String)])),
  hasJSModule: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.String])),
  hasJSNext: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.String])),
  isModuleType: Schema.optionalKey(Schema.Boolean),
  ignoredMissingDependencies: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type BundlephobiaBuild = typeof BundlephobiaBuildSchema.Type;

/** Standalone provider build, including bundled dependencies; not application impact or unpacked size. */
export const PackageBundleSizeSchema = Schema.Union([
  Schema.Struct({
    ...BundlephobiaBuildSchema.fields,
    provider: Schema.Literal('bundlephobia'),
    url: Schema.String,
    status: Schema.Literal('available'),
    retrievedAt: Schema.String,
  }),
  Schema.Struct({
    provider: Schema.Literal('bundlephobia'),
    url: Schema.String,
    status: Schema.Literal('unavailable'),
    size: Schema.Null,
    gzip: Schema.Null,
  }),
]);

export type PackageBundleSize = typeof PackageBundleSizeSchema.Type;
