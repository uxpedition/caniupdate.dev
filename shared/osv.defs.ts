import { Schema } from 'effect';

export const OsvQueryBatchRequestSchema = Schema.Struct({
  queries: Schema.Array(
    Schema.Struct({
      package: Schema.Struct({
        name: Schema.String,
        ecosystem: Schema.Literal('npm'),
      }),
      version: Schema.String,
      page_token: Schema.optionalKey(Schema.String),
    }),
  ),
});

export type OsvQueryBatchRequest = typeof OsvQueryBatchRequestSchema.Type;

export const OsvQueryBatchResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      vulns: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            modified: Schema.String,
          }),
        ),
      ),
      next_page_token: Schema.optionalKey(Schema.String),
    }),
  ),
});

export type OsvQueryBatchResponse = typeof OsvQueryBatchResponseSchema.Type;

const OsvSeveritySchema = Schema.Struct({
  type: Schema.String,
  score: Schema.String,
});

const OsvRangeEventSchema = Schema.Struct({
  introduced: Schema.optionalKey(Schema.String),
  fixed: Schema.optionalKey(Schema.String),
  last_affected: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.String),
});

const OsvAffectedSchema = Schema.Struct({
  package: Schema.Struct({
    ecosystem: Schema.String,
    name: Schema.String,
    purl: Schema.optionalKey(Schema.String),
  }),
  ranges: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        repo: Schema.optionalKey(Schema.String),
        events: Schema.NonEmptyArray(OsvRangeEventSchema),
      }),
    ),
  ),
  versions: Schema.optionalKey(Schema.Array(Schema.String)),
  severity: Schema.optionalKey(Schema.NullOr(Schema.Array(OsvSeveritySchema))),
  ecosystem_specific: Schema.optionalKey(Schema.Unknown),
  database_specific: Schema.optionalKey(Schema.Unknown),
});

/** Documented OSV record fields; provider-specific blobs stay opaque until a consumer needs them. */
export const OsvVulnerabilitySchema = Schema.Struct({
  schema_version: Schema.optionalKey(Schema.String),
  id: Schema.String,
  modified: Schema.String,
  published: Schema.optionalKey(Schema.String),
  withdrawn: Schema.optionalKey(Schema.String),
  aliases: Schema.optionalKey(Schema.Array(Schema.String)),
  related: Schema.optionalKey(Schema.Array(Schema.String)),
  summary: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(Schema.Array(OsvSeveritySchema)),
  affected: Schema.optionalKey(Schema.Array(OsvAffectedSchema)),
  references: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        url: Schema.String,
      }),
    ),
  ),
  database_specific: Schema.optionalKey(Schema.Unknown),
});

export type OsvVulnerability = typeof OsvVulnerabilitySchema.Type;

const PackageAdvisorySchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    url: Schema.String,
    detailsStatus: Schema.Literal('available'),
    modified: OsvVulnerabilitySchema.fields.modified,
    published: OsvVulnerabilitySchema.fields.published,
    summary: OsvVulnerabilitySchema.fields.summary,
    aliases: OsvVulnerabilitySchema.fields.aliases,
    severity: OsvVulnerabilitySchema.fields.severity,
    references: OsvVulnerabilitySchema.fields.references,
    affected: OsvVulnerabilitySchema.fields.affected,
  }),
  Schema.Struct({
    id: Schema.String,
    url: Schema.String,
    detailsStatus: Schema.Literal('unavailable'),
  }),
]);

export type PackageAdvisory = typeof PackageAdvisorySchema.Type;

export const PackageVulnerabilitiesSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('unavailable'),
    count: Schema.Null,
    advisories: Schema.Array(PackageAdvisorySchema),
  }),
  Schema.Struct({
    status: Schema.Literals(['available', 'partial']),
    // Unique OSV IDs, excluding confirmed withdrawn records; partial results are not exhaustive.
    count: Schema.Number,
    advisories: Schema.Array(PackageAdvisorySchema),
  }),
]);

export type PackageVulnerabilities = typeof PackageVulnerabilitiesSchema.Type;
