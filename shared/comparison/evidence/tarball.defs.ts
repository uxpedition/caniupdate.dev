import { Schema } from 'effect';

import { InstallInspectionSchema } from './installScripts.defs';

const PublishedFileSchema = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(['file', 'directory', 'symlink', 'link']),
  size: Schema.Number,
  sha256: Schema.NullOr(Schema.String),
  linkTarget: Schema.optionalKey(Schema.String),
});

export type PublishedFile = typeof PublishedFileSchema.Type;

const ShippedChangelogSchema = Schema.Struct({
  path: Schema.String,
  body: Schema.String,
  truncated: Schema.Boolean,
});

export type ShippedChangelog = typeof ShippedChangelogSchema.Type;

export const PackageTarballSchema = Schema.Struct({
  status: Schema.Literals(['available', 'partial', 'unavailable']),
  reasons: Schema.Array(Schema.String),
  url: Schema.String,
  files: Schema.Array(PublishedFileSchema),
  changelogs: Schema.Array(ShippedChangelogSchema),
  installInspection: InstallInspectionSchema,
});

export type PackageTarball = typeof PackageTarballSchema.Type;
