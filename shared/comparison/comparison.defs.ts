import { Schema } from 'effect';

import { PackageBundleSizeSchema, type PackageBundleSize } from './evidence/bundlephobia.defs';
import { PackageAdvisorySchema, PackageVulnerabilitiesSchema, type PackageVulnerabilities } from './evidence/osv.defs';
import { PackageTarballSchema, type PackageTarball } from './evidence/tarball.defs';
import { ParsedPackageVersionSchema, type ParsedPackageVersion } from './package/package.defs';

export type ComparisonVersion = ParsedPackageVersion & {
  vulnerabilities: PackageVulnerabilities;
  bundleSize: PackageBundleSize;
  tarball: PackageTarball;
};

export type ValueComparison<T> = {
  changed: boolean;
  from: T | null;
  to: T | null;
  fromDeclared: boolean;
  toDeclared: boolean;
};

export type DeclarationChange<T> = {
  name: string;
  kind: 'added' | 'removed' | 'changed';
  from: T | null;
  to: T | null;
};

export type DependencyRequirement = { category: 'runtime' | 'optional'; range: string };

export type PeerRequirement = { range: string; optional: boolean };

export type SizeComparison = typeof SizeComparisonSchema.Type;

export type AdvisoryGroup = typeof AdvisoryGroupSchema.Type;

export type AdvisoryComparison = typeof AdvisoryComparisonSchema.Type;

type ModuleDeclaration = Pick<ParsedPackageVersion['moduleFormat'], 'type' | 'main' | 'module'>;

type TypeDeclaration = Pick<ParsedPackageVersion['moduleFormat'], 'types' | 'typings' | 'typesVersions'> & {
  /** Full map retains condition context and ordering, including nested type conditions. */
  exports: ParsedPackageVersion['moduleFormat']['exports'] | null;
};

export type DeclarationComparison = {
  dependencies: DeclarationChange<DependencyRequirement>[];
  peers: DeclarationChange<PeerRequirement>[];
  node: ValueComparison<string>;
  moduleFormat: ValueComparison<ModuleDeclaration>;
  exports: ValueComparison<Exclude<ParsedPackageVersion['moduleFormat']['exports'], undefined>>;
  types: ValueComparison<TypeDeclaration>;
  licenses: { changed: boolean; from: string[]; to: string[]; added: string[]; removed: string[] };
  installScripts: DeclarationChange<string>[];
};

export type MeasurementComparison = typeof MeasurementComparisonSchema.Type;

export type PackageComparison = DeclarationComparison & MeasurementComparison;

/** Inspected-archive evidence without the per-file inventory, which stays server-side. */
export type TarballSummary = typeof TarballSummarySchema.Type;

/** Registry manifest fields only; what the declarations route returns per version. */
export type DeclaredPackageVersion = ParsedPackageVersion;

/** Manifest fields plus measurement evidence; what the measurements route returns per version. */
export type MeasuredPackageVersion = typeof MeasuredPackageVersionSchema.Type;

export type PackageDeclarationsResponse = {
  packageName: string;
  from: DeclaredPackageVersion;
  to: DeclaredPackageVersion;
  comparison: DeclarationComparison;
};

export type PackageMeasurementsResponse = typeof PackageMeasurementsResponseSchema.Type;

const DependencyRequirementSchema = Schema.Struct({
  category: Schema.Literals(['runtime', 'optional']),
  range: Schema.String,
});

const PeerRequirementSchema = Schema.Struct({ range: Schema.String, optional: Schema.Boolean });

const DeclarationChangeSchema = <Value>(value: Schema.Codec<Value>) =>
  Schema.Struct({
    name: Schema.String,
    kind: Schema.Literals(['added', 'removed', 'changed']),
    from: Schema.NullOr(value),
    to: Schema.NullOr(value),
  });

const ModuleDeclarationSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  main: Schema.optionalKey(Schema.String),
  module: Schema.optionalKey(Schema.String),
});

const TypeDeclarationSchema = Schema.Struct({
  types: Schema.optionalKey(Schema.String),
  typings: Schema.optionalKey(Schema.String),
  typesVersions: Schema.optionalKey(Schema.Json),
  exports: Schema.NullOr(Schema.Json),
});

const ValueComparisonSchema = <Value>(value: Schema.Codec<Value>) =>
  Schema.Struct({
    changed: Schema.Boolean,
    from: Schema.NullOr(value),
    to: Schema.NullOr(value),
    fromDeclared: Schema.Boolean,
    toDeclared: Schema.Boolean,
  });

const DeclarationComparisonSchema = Schema.Struct({
  dependencies: Schema.Array(DeclarationChangeSchema(DependencyRequirementSchema)),
  peers: Schema.Array(DeclarationChangeSchema(PeerRequirementSchema)),
  node: ValueComparisonSchema(Schema.String),
  moduleFormat: ValueComparisonSchema(ModuleDeclarationSchema),
  exports: ValueComparisonSchema(Schema.Json),
  types: ValueComparisonSchema(TypeDeclarationSchema),
  licenses: Schema.Struct({
    changed: Schema.Boolean,
    from: Schema.Array(Schema.String),
    to: Schema.Array(Schema.String),
    added: Schema.Array(Schema.String),
    removed: Schema.Array(Schema.String),
  }),
  installScripts: Schema.Array(DeclarationChangeSchema(Schema.String)),
});

export const PackageDeclarationsResponseSchema = Schema.Struct({
  packageName: Schema.String,
  from: ParsedPackageVersionSchema,
  to: ParsedPackageVersionSchema,
  comparison: DeclarationComparisonSchema,
});

// Boundary schemas for the measurements route. Each decoded value satisfies the public types above. Arrays are
// `Schema.mutable` because the comparison producer appends to and sorts them while assembling the response.
const AvailabilitySchema = Schema.Literals(['available', 'partial', 'unavailable']);

const MutableStringsSchema = Schema.mutable(Schema.Array(Schema.String));

const SizeComparisonSchema = Schema.Struct({
  status: Schema.mutableKey(AvailabilitySchema),
  from: Schema.NullOr(Schema.Number),
  to: Schema.NullOr(Schema.Number),
  delta: Schema.mutableKey(Schema.NullOr(Schema.Number)),
  percent: Schema.mutableKey(Schema.NullOr(Schema.Number)),
  reasons: MutableStringsSchema,
});

const AdvisoryGroupSchema = Schema.Struct({
  ids: Schema.mutableKey(MutableStringsSchema),
  aliases: Schema.mutableKey(MutableStringsSchema),
  from: Schema.mutable(Schema.Array(PackageAdvisorySchema)),
  to: Schema.mutable(Schema.Array(PackageAdvisorySchema)),
});

const AdvisoryGroupsSchema = Schema.mutable(Schema.Array(AdvisoryGroupSchema));

const AdvisoryComparisonSchema = Schema.Struct({
  status: AvailabilitySchema,
  coverage: Schema.Struct({ from: AvailabilitySchema, to: AvailabilitySchema }),
  reasons: MutableStringsSchema,
  fromOnly: AdvisoryGroupsSchema,
  both: AdvisoryGroupsSchema,
  toOnly: AdvisoryGroupsSchema,
  /** A one-sided match cannot be classified as exclusive when opposite-side coverage is incomplete. */
  uncertain: AdvisoryGroupsSchema,
});

const SizeSourceSchema = Schema.NullOr(Schema.Literals(['registry', 'tarball']));

const MeasurementComparisonSchema = Schema.Struct({
  sizes: Schema.Struct({
    unpacked: Schema.Struct({
      ...SizeComparisonSchema.fields,
      sources: Schema.Struct({ from: SizeSourceSchema, to: SizeSourceSchema }),
    }),
    bundle: Schema.Struct({
      provider: Schema.Literal('bundlephobia'),
      methodology: Schema.Literal('provider-estimate'),
      minified: SizeComparisonSchema,
      gzip: SizeComparisonSchema,
    }),
  }),
  advisories: AdvisoryComparisonSchema,
});

const TarballSummarySchema = Schema.Struct({
  status: PackageTarballSchema.fields.status,
  reasons: Schema.Array(Schema.String),
  url: Schema.String,
  fileCount: Schema.Number,
  changelogCount: Schema.Number,
});

const MeasuredPackageVersionSchema = Schema.Struct({
  ...ParsedPackageVersionSchema.fields,
  vulnerabilities: PackageVulnerabilitiesSchema,
  bundleSize: PackageBundleSizeSchema,
  tarball: TarballSummarySchema,
});

/**
 * Decode boundary for the measurements route. Decode with `onExcessProperty: 'error'`: the per-file and changelog
 * inventories are server-side only, so any excess key (such as `files` on a tarball summary) is a protocol violation.
 */
export const PackageMeasurementsResponseSchema = Schema.Struct({
  packageName: Schema.String,
  from: MeasuredPackageVersionSchema,
  to: MeasuredPackageVersionSchema,
  comparison: MeasurementComparisonSchema,
});
