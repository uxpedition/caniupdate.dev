import { Schema } from 'effect';

import { compareSemver } from './compareSemver';

const RegistryPackageDistSchema = Schema.Struct({
  tarball: Schema.String,
  shasum: Schema.String,
  integrity: Schema.optionalKey(Schema.String),
});

const RegistryPackageVersionSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dist: RegistryPackageDistSchema,
});

export const RegistryPackageMetadataSchema = Schema.Struct({
  name: Schema.String,
  modified: Schema.String,
  'dist-tags': Schema.Record(Schema.String, Schema.String),
  versions: Schema.Record(Schema.String, RegistryPackageVersionSchema),
});

export type RegistryPackageMetadata = typeof RegistryPackageMetadataSchema.Type;

const ParsedPackageMetadataSchema = Schema.Struct({
  name: Schema.String,
  modified: Schema.String,
  distTags: Schema.Record(Schema.String, Schema.String),
  versions: Schema.Array(Schema.String),
});

export type ParsedPackageMetadata = typeof ParsedPackageMetadataSchema.Type;

export function toPackageMetadata(response: RegistryPackageMetadata): ParsedPackageMetadata {
  return {
    name: response.name,
    modified: response.modified,
    distTags: response['dist-tags'],
    versions: Object.values(response.versions)
      .map(({ version }) => version)
      .sort((left, right) => compareSemver(right, left)),
  };
}
