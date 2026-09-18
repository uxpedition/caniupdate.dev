import type { PackageBundleSize } from './bundlephobia.defs';
import type { PackageAdvisory, PackageVulnerabilities } from './osv.defs';
import type { ParsedPackageVersion } from './package.defs';
import type { PackageTarball } from './tarball.defs';

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
export type PackageComparison = {
  dependencies: DeclarationChange<DependencyRequirement>[];
  peers: DeclarationChange<PeerRequirement>[];
  node: ValueComparison<string>;
  moduleFormat: ValueComparison<ModuleDeclaration>;
  exports: ValueComparison<Exclude<ParsedPackageVersion['moduleFormat']['exports'], undefined>>;
  types: ValueComparison<TypeDeclaration>;
  licenses: { changed: boolean; from: string[]; to: string[]; added: string[]; removed: string[] };
  installScripts: DeclarationChange<string>[];
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
