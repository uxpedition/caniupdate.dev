import type { ComparisonVersion, PackageComparison } from './comparison.defs';
import type { PackageReleaseNotes } from './github.defs';

export type BriefingInput = {
  packageName: string;
  from: ComparisonVersion;
  to: ComparisonVersion;
  comparison: PackageComparison;
  releaseNotes: PackageReleaseNotes;
};

export type BriefingSource = {
  id: string;
  kind: 'fact' | 'maintainer' | 'coverage';
  label: string;
  urls: readonly string[];
  text: string;
};

export type BriefingEvidence = {
  packageName: string;
  from: string;
  to: string;
  sources: readonly BriefingSource[];
  gaps: readonly string[];
};

export type BriefingBullet = {
  kind: 'change' | 'migration' | 'coverage';
  basis: 'fact' | 'maintainer' | 'inference';
  text: string;
  evidenceIds: readonly string[];
};

export type BriefingUnavailableReason =
  | 'not-configured'
  | 'invalid-config'
  | 'provider-error'
  | 'timeout'
  | 'invalid-response';

export type PackageBriefing =
  | { status: 'available'; model: string; bullets: readonly BriefingBullet[]; sources: readonly BriefingSource[] }
  | { status: 'unavailable'; reason: BriefingUnavailableReason; bullets: readonly []; sources: readonly [] };
