import { Schema } from 'effect';

const RegistryPackageLinksSchema = Schema.Struct({
  npm: Schema.String,
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  bugs: Schema.optionalKey(Schema.String),
});

const RegistryPackagePersonSchema = Schema.Struct({
  username: Schema.String,
  email: Schema.optionalKey(Schema.String),
});

const RegistryPackageSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  date: Schema.String,
  links: RegistryPackageLinksSchema,
  publisher: RegistryPackagePersonSchema,
  maintainers: Schema.Array(RegistryPackagePersonSchema),
});

const RegistrySearchScoreDetailSchema = Schema.Struct({
  quality: Schema.Number,
  popularity: Schema.Number,
  maintenance: Schema.Number,
});

const RegistrySearchScoreSchema = Schema.Struct({
  final: Schema.Number,
  detail: RegistrySearchScoreDetailSchema,
});

const RegistryPackageSearchResultSchema = Schema.Struct({
  package: RegistryPackageSchema,
  score: RegistrySearchScoreSchema,
  searchScore: Schema.Number,
});

export const RegistryPackagesSearchResponseSchema = Schema.Struct({
  objects: Schema.Array(RegistryPackageSearchResultSchema),
  total: Schema.Number,
  time: Schema.String,
});

export type RegistryPackagesSearchResponse = typeof RegistryPackagesSearchResponseSchema.Type;

const ParsedPackageSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  versionPublishedAt: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
});

const ParsedPackagesSearchResponseSchema = Schema.Struct({
  data: Schema.Array(ParsedPackageSchema),
  total: Schema.Number,
  time: Schema.String,
});

export type ParsedPackagesSearchResult = typeof ParsedPackagesSearchResponseSchema.Type;

export function toSearchResults(response: RegistryPackagesSearchResponse): ParsedPackagesSearchResult {
  return {
    data: response.objects.map(({ package: pkg }) => ({
      name: pkg.name,
      version: pkg.version,
      versionPublishedAt: pkg.date,

      ...(pkg.description === undefined ? {} : { description: pkg.description }),

      ...(pkg.license === undefined ? {} : { license: pkg.license }),
    })),

    total: response.total,
    time: response.time,
  };
}
