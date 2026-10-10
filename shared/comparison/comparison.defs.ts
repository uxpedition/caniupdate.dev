import type { PackageBundleSize } from './evidence/bundlephobia.defs';
import type { PackageAdvisory, PackageVulnerabilities } from './evidence/osv.defs';
import type { PackageTarball } from './evidence/tarball.defs';
import type { ParsedPackageVersion } from './package/package.defs';

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

export type SizeComparison = {
  status: 'available' | 'partial' | 'unavailable';
  from: number | null;
  to: number | null;
  delta: number | null;
  percent: number | null;
  reasons: string[];
};

export type AdvisoryGroup = {
  ids: string[];
  aliases: string[];
  from: PackageAdvisory[];
  to: PackageAdvisory[];
};

export type AdvisoryComparison = {
  status: 'available' | 'partial' | 'unavailable';
  coverage: { from: PackageVulnerabilities['status']; to: PackageVulnerabilities['status'] };
  reasons: string[];
  fromOnly: AdvisoryGroup[];
  both: AdvisoryGroup[];
  toOnly: AdvisoryGroup[];
  /** A one-sided match cannot be classified as exclusive when opposite-side coverage is incomplete. */
  uncertain: AdvisoryGroup[];
};

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

export type MeasurementComparison = {
  sizes: {
    unpacked: SizeComparison & { sources: { from: 'registry' | 'tarball' | null; to: 'registry' | 'tarball' | null } };
    bundle: {
      provider: 'bundlephobia';
      methodology: 'provider-estimate';
      minified: SizeComparison;
      gzip: SizeComparison;
    };
  };
  advisories: AdvisoryComparison;
};

export type PackageComparison = DeclarationComparison & MeasurementComparison;

/** Inspected-archive evidence without the per-file inventory, which stays server-side. */
export type TarballSummary = {
  status: PackageTarball['status'];
  reasons: readonly string[];
  url: string;
  fileCount: number;
  changelogCount: number;
};

/** Registry manifest fields only; what the declarations route returns per version. */
export type DeclaredPackageVersion = ParsedPackageVersion;

/** Manifest fields plus measurement evidence; what the measurements route returns per version. */
export type MeasuredPackageVersion = Omit<ComparisonVersion, 'tarball'> & { tarball: TarballSummary };

export type PackageDeclarationsResponse = {
  packageName: string;
  from: DeclaredPackageVersion;
  to: DeclaredPackageVersion;
  comparison: DeclarationComparison;
};

export type PackageMeasurementsResponse = {
  packageName: string;
  from: MeasuredPackageVersion;
  to: MeasuredPackageVersion;
  comparison: MeasurementComparison;
};
