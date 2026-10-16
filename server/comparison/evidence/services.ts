import type { Effect } from 'effect';

import type { PackageEvidenceFailure } from './errors';

/** Lookup outcome reported for diagnostics only; it never changes the value returned to the caller. */
export type ComparisonEvidenceCacheDecision = 'hit' | 'miss' | 'coalesced';

export type ComparisonEvidenceCacheOptions<T> = {
  readonly ttlMs: number | null;
  readonly cacheable: (value: T) => boolean;
  readonly isValid: (value: unknown) => value is T;
  /** Called at most once per lookup; a throwing observer never changes the lookup's value or failure. */
  readonly observe?: (decision: ComparisonEvidenceCacheDecision) => void;
};

/** Persistence/coalescing belongs to the caller, so collection stays request-scoped. */
export type ComparisonEvidenceCache = {
  load<T>(key: string, loader: () => Promise<T>, options: ComparisonEvidenceCacheOptions<T>): Promise<T>;
};

export type ArchiveAdmission = {
  withPermit<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | PackageEvidenceFailure, R>;
};

export type ComparisonEvidenceServices = {
  readonly cache?: ComparisonEvidenceCache;
  readonly archiveAdmission?: ArchiveAdmission;
  readonly githubToken?: string;
};
