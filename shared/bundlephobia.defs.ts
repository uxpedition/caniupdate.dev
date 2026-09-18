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
export type PackageBundleSize = {
  readonly provider: 'bundlephobia';
  readonly url: string;
} & (
  | ({ readonly status: 'available'; readonly retrievedAt: string } & BundlephobiaBuild)
  | { readonly status: 'unavailable'; readonly size: null; readonly gzip: null }
);
