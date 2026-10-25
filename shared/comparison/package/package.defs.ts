import { Predicate, Schema } from 'effect';

import { sortSemverDescendingInPlace } from './compareSemver';

const PACKAGE_NAME_MAX_LENGTH = 214;

const PACKAGE_NAME_STRUCTURE_PATTERN = /^(?:@[^/.][^/]*\/)?[^/.][^/]*$/;

export const PackageNameSchema = Schema.String.check(
  Schema.isMaxLength(PACKAGE_NAME_MAX_LENGTH),
  Schema.isPattern(PACKAGE_NAME_STRUCTURE_PATTERN),
  Schema.makeFilter(
    (name: string) =>
      (name.startsWith('@') ? name.slice(1) : name)
        .split('/')
        .every((segment) => encodeURIComponent(segment) === segment),
    { expected: 'a URL-safe package name' },
  ),
);

export const PackageMetadataRequestSchema = Schema.Struct({ packageName: PackageNameSchema });

const RegistryPackageDistSchema = Schema.Struct({
  tarball: Schema.String,
  shasum: Schema.String,
  integrity: Schema.optionalKey(Schema.String),
  unpackedSize: Schema.optionalKey(Schema.Number),
  fileCount: Schema.optionalKey(Schema.Number),
});

const RegistryPackageVersionSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dist: RegistryPackageDistSchema,
  deprecated: Schema.optionalKey(Schema.String),
});

export const RegistryPackageMetadataSchema = Schema.Struct({
  name: Schema.String,
  modified: Schema.String,
  'dist-tags': Schema.Record(Schema.String, Schema.String),
  versions: Schema.Record(Schema.String, RegistryPackageVersionSchema),
});

export type RegistryPackageMetadata = typeof RegistryPackageMetadataSchema.Type;

export const ParsedPackageMetadataSchema = Schema.Struct({
  name: Schema.String,
  modified: Schema.String,
  distTags: Schema.Record(Schema.String, Schema.String),
  versions: Schema.Array(Schema.String),
  latestRelease: Schema.optionalKey(
    Schema.Struct({
      version: Schema.String,
      deprecated: Schema.optionalKey(Schema.String),
    }),
  ),
});

export type ParsedPackageMetadata = typeof ParsedPackageMetadataSchema.Type;

type PackageMetadataResult = { -readonly [Key in keyof ParsedPackageMetadata]: ParsedPackageMetadata[Key] };

type LatestPackageRelease = {
  -readonly [Key in keyof NonNullable<ParsedPackageMetadata['latestRelease']>]: NonNullable<
    ParsedPackageMetadata['latestRelease']
  >[Key];
};

export function toPackageMetadata(response: RegistryPackageMetadata): ParsedPackageMetadata {
  const versions = Object.values(response.versions).map(({ version }) => version);
  sortSemverDescendingInPlace(versions);

  const latestVersion = response['dist-tags'].latest;
  const latest = latestVersion === undefined ? undefined : response.versions[latestVersion];

  const metadata: PackageMetadataResult = {
    name: response.name,
    modified: response.modified,
    distTags: response['dist-tags'],
    versions,
  };

  if (latest) {
    const latestRelease: LatestPackageRelease = { version: latest.version };

    if (latest.deprecated !== undefined) latestRelease.deprecated = latest.deprecated;

    metadata.latestRelease = latestRelease;
  }

  return metadata;
}

const RegistryPackageLicenseSchema = Schema.Struct({
  type: Schema.String,
  url: Schema.optionalKey(Schema.String),
});

export const RegistryVersionManifestSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  // Enrichment validates optional source metadata independently; malformed values must not discard npm/OSV facts.
  repository: Schema.optionalKey(Schema.Unknown),
  gitHead: Schema.optionalKey(Schema.Unknown),
  dist: RegistryPackageDistSchema,
  license: Schema.optionalKey(Schema.Union([Schema.String, RegistryPackageLicenseSchema])),
  licenses: Schema.optionalKey(Schema.Array(RegistryPackageLicenseSchema)),
  deprecated: Schema.optionalKey(Schema.String),
  engines: Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Array(Schema.String)])),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependenciesMeta: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
  ),
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  type: Schema.optionalKey(Schema.String),
  main: Schema.optionalKey(Schema.String),
  module: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(Schema.Json),
  types: Schema.optionalKey(Schema.String),
  typings: Schema.optionalKey(Schema.String),
  typesVersions: Schema.optionalKey(Schema.Json),
});

export type RegistryVersionManifest = typeof RegistryVersionManifestSchema.Type;

// An unused manifest field must not prevent resolving a different, valid mapping.
export const PublishedModuleManifestSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.Json),
  main: Schema.optionalKey(Schema.Json),
  exports: Schema.optionalKey(Schema.Json),
  imports: Schema.optionalKey(Schema.Json),
});

export type PublishedModuleManifest = typeof PublishedModuleManifestSchema.Type;

const INSTALL_SCRIPT_NAMES = ['preinstall', 'install', 'postinstall'] as const;

const ParsedPackageDistSchema = Schema.Struct({
  tarball: Schema.String,
  integrity: Schema.optionalKey(Schema.String),
  unpackedSize: Schema.optionalKey(Schema.Number),
  fileCount: Schema.optionalKey(Schema.Number),
});

const ParsedPackageModuleFormatSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  main: Schema.optionalKey(Schema.String),
  module: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(Schema.Json),
  types: Schema.optionalKey(Schema.String),
  typings: Schema.optionalKey(Schema.String),
  typesVersions: Schema.optionalKey(Schema.Json),
});

export const ParsedPackageVersionSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  dist: ParsedPackageDistSchema,
  licenses: Schema.Array(Schema.String),
  deprecated: Schema.Boolean,
  deprecationMessage: Schema.optionalKey(Schema.String),
  engines: Schema.Record(Schema.String, Schema.String),
  dependencies: Schema.Record(Schema.String, Schema.String),
  peerDependencies: Schema.Record(Schema.String, Schema.String),
  optionalDependencies: Schema.Record(Schema.String, Schema.String),
  optionalPeers: Schema.Array(Schema.String),
  installScripts: Schema.Array(Schema.String),
  installScriptCommands: Schema.Record(Schema.String, Schema.String),
  moduleFormat: ParsedPackageModuleFormatSchema,
});

export type ParsedPackageVersion = typeof ParsedPackageVersionSchema.Type;

// `Array.isArray` does not narrow a `readonly` array arm out of the union, so this check needs its own guard.
const isEngineDeclarationList = (
  engines: NonNullable<RegistryVersionManifest['engines']>,
): engines is readonly string[] => Array.isArray(engines);

// A bare engine name declares support without a version constraint, which is kept as an empty constraint.
const toEngines = (engines: RegistryVersionManifest['engines']): Record<string, string> => {
  if (engines === undefined) {
    return {};
  }

  if (!isEngineDeclarationList(engines)) {
    return engines;
  }

  return Object.fromEntries(
    engines.map((declaration) => {
      const separator = declaration.indexOf(' ');

      return separator === -1
        ? [declaration, '']
        : [declaration.slice(0, separator), declaration.slice(separator + 1).trim()];
    }),
  );
};

const toLicenses = (manifest: RegistryVersionManifest): readonly string[] => {
  if (manifest.license !== undefined) {
    return [Predicate.isString(manifest.license) ? manifest.license : manifest.license.type];
  }

  return (manifest.licenses ?? []).map(({ type }) => type).filter((type) => type.length > 0);
};

// Published descriptions are free text: some versions carry none and others pad or blank the value.
const toDescription = (manifest: RegistryVersionManifest): string | undefined => {
  const description = manifest.description?.trim();

  return description === undefined || description === '' ? undefined : description;
};

const toOptionalPeers = (peerDependenciesMeta: RegistryVersionManifest['peerDependenciesMeta']): readonly string[] => {
  const optionalPeers: string[] = [];

  for (const [peerName, meta] of Object.entries(peerDependenciesMeta ?? {})) {
    if (meta.optional === true) {
      optionalPeers.push(peerName);
    }
  }

  return optionalPeers;
};

// Schema-derived outputs are readonly; these builders own their object until they return it.
type Writable<T> = { -readonly [Key in keyof T]: T[Key] };

type PackageIdentity = Pick<Writable<ParsedPackageVersion>, 'name' | 'version' | 'description'>;

type PackageDeprecation = Pick<Writable<ParsedPackageVersion>, 'deprecated' | 'deprecationMessage'>;

const toPackageDist = (dist: RegistryVersionManifest['dist']): ParsedPackageVersion['dist'] => {
  const packageDist: Writable<ParsedPackageVersion['dist']> = { tarball: dist.tarball };

  if (dist.integrity !== undefined) packageDist.integrity = dist.integrity;

  if (dist.unpackedSize !== undefined) packageDist.unpackedSize = dist.unpackedSize;

  if (dist.fileCount !== undefined) packageDist.fileCount = dist.fileCount;

  return packageDist;
};

const toModuleFormat = (manifest: RegistryVersionManifest): ParsedPackageVersion['moduleFormat'] => {
  const moduleFormat: Writable<ParsedPackageVersion['moduleFormat']> = {};

  if (manifest.type !== undefined) moduleFormat.type = manifest.type;

  if (manifest.main !== undefined) moduleFormat.main = manifest.main;

  if (manifest.module !== undefined) moduleFormat.module = manifest.module;

  if (manifest.exports !== undefined) moduleFormat.exports = manifest.exports;

  if (manifest.types !== undefined) moduleFormat.types = manifest.types;

  if (manifest.typings !== undefined) moduleFormat.typings = manifest.typings;

  if (manifest.typesVersions !== undefined) moduleFormat.typesVersions = manifest.typesVersions;

  return moduleFormat;
};

export function toPackageVersion(manifest: RegistryVersionManifest): ParsedPackageVersion {
  const identity: PackageIdentity = { name: manifest.name, version: manifest.version };
  const description = toDescription(manifest);

  if (description !== undefined) identity.description = description;
  const deprecation: PackageDeprecation = { deprecated: manifest.deprecated !== undefined };

  if (manifest.deprecated !== undefined) deprecation.deprecationMessage = manifest.deprecated;

  return {
    ...identity,
    dist: toPackageDist(manifest.dist),
    licenses: toLicenses(manifest),
    ...deprecation,
    engines: toEngines(manifest.engines),
    dependencies: manifest.dependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
    optionalPeers: toOptionalPeers(manifest.peerDependenciesMeta),
    installScripts: INSTALL_SCRIPT_NAMES.filter((name) => manifest.scripts?.[name] !== undefined),
    installScriptCommands: Object.fromEntries(
      INSTALL_SCRIPT_NAMES.flatMap((name) => {
        const command = manifest.scripts?.[name];

        return command === undefined ? [] : [[name, command]];
      }),
    ),
    moduleFormat: toModuleFormat(manifest),
  };
}
