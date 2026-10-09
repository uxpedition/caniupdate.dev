import { Schema } from 'effect';

const PackageReleaseSchema = Schema.Struct({
  version: Schema.String,
  tag: Schema.String,
  name: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.String,
});

export type PackageRelease = typeof PackageReleaseSchema.Type;

const PackageChangelogSchema = Schema.Struct({
  body: Schema.String,
  url: Schema.String,
  path: Schema.String,
  ref: Schema.String,
});

export type PackageChangelog = typeof PackageChangelogSchema.Type;

export const PackageReleaseNotesSchema = Schema.Struct({
  status: Schema.Literals(['available', 'partial', 'unavailable']),
  reasons: Schema.Array(Schema.String),
  releases: Schema.Array(PackageReleaseSchema),
  changelog: Schema.NullOr(PackageChangelogSchema),
});

export type PackageReleaseNotes = typeof PackageReleaseNotesSchema.Type;
