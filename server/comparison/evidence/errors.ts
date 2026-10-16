import { Data, Predicate } from 'effect';

import { RegistryRequestError } from '../../httpDependencies/npm/errors';

export const EvidenceCacheError = Data.TaggedError('EvidenceCacheError')<{
  readonly cause: unknown;
}>;

export const EvidenceCollectionError = Data.TaggedError('EvidenceCollectionError')<{
  readonly cause: unknown;
}>;

export const EvidenceStorageError = Data.TaggedError('EvidenceStorageError')<{
  readonly operation: 'initialize' | 'read' | 'write' | 'cleanup' | 'delete' | 'serialize';
  readonly cause: unknown;
}>;

export const EvidenceStorageCorruptionError = Data.TaggedError('EvidenceStorageCorruptionError')<{
  readonly detail: string;
  readonly cause?: unknown;
}>;

export const ArchiveCapacityError = Data.TaggedError('ArchiveCapacityError')<{
  readonly capacity: number;
}>;

export const ResponseCapacityError = Data.TaggedError('ResponseCapacityError')<{
  readonly capacity: number;
}>;

export type PackageEvidenceFailure =
  | InstanceType<typeof RegistryRequestError>
  | InstanceType<typeof EvidenceCacheError>
  | InstanceType<typeof EvidenceCollectionError>
  | InstanceType<typeof EvidenceStorageError>
  | InstanceType<typeof EvidenceStorageCorruptionError>
  | InstanceType<typeof ArchiveCapacityError>
  | InstanceType<typeof ResponseCapacityError>;

export const isPackageEvidenceFailure = (cause: unknown): cause is PackageEvidenceFailure =>
  cause instanceof RegistryRequestError ||
  cause instanceof EvidenceCacheError ||
  cause instanceof EvidenceCollectionError ||
  cause instanceof EvidenceStorageError ||
  cause instanceof EvidenceStorageCorruptionError ||
  cause instanceof ArchiveCapacityError ||
  cause instanceof ResponseCapacityError;

export const toPackageEvidenceFailure = (cause: unknown): PackageEvidenceFailure =>
  isPackageEvidenceFailure(cause) ? cause : new EvidenceCollectionError({ cause });

export const toEvidenceCacheFailure = (cause: unknown): PackageEvidenceFailure =>
  isPackageEvidenceFailure(cause) ? cause : new EvidenceCacheError({ cause });

export type EvidenceStorageFailure =
  | InstanceType<typeof EvidenceStorageError>
  | InstanceType<typeof EvidenceStorageCorruptionError>;

/** Fixed telemetry reasons; raw causes, SQL, keys, and rows never leave the evidence modules. */
export type EvidenceFailureReason =
  | 'upstream'
  | 'unexpected'
  | 'capacity'
  | 'storage-initialize'
  | 'storage-read'
  | 'storage-write'
  | 'storage-delete'
  | 'storage-serialize'
  | 'storage-corrupt';

export type EvidenceStorageDiagnostic = {
  readonly operation: 'initialize' | 'read' | 'write' | 'delete' | 'serialize';
  readonly reason: EvidenceFailureReason;
};

const storageDiagnostics = {
  initialize: { operation: 'initialize', reason: 'storage-initialize' },
  read: { operation: 'read', reason: 'storage-read' },
  write: { operation: 'write', reason: 'storage-write' },
  delete: { operation: 'delete', reason: 'storage-delete' },
  // Expired-row cleanup is a delete from the caller's point of view.
  cleanup: { operation: 'delete', reason: 'storage-delete' },
  serialize: { operation: 'serialize', reason: 'storage-serialize' },
} as const satisfies Record<InstanceType<typeof EvidenceStorageError>['operation'], EvidenceStorageDiagnostic>;

export const evidenceStorageDiagnostic = (error: EvidenceStorageFailure): EvidenceStorageDiagnostic =>
  Predicate.isTagged(error, 'EvidenceStorageCorruptionError')
    ? { operation: 'read', reason: 'storage-corrupt' }
    : storageDiagnostics[error.operation];

export const evidenceFailureReason = (cause: unknown): EvidenceFailureReason => {
  if (cause instanceof ArchiveCapacityError || cause instanceof ResponseCapacityError) return 'capacity';

  if (cause instanceof EvidenceStorageError || cause instanceof EvidenceStorageCorruptionError)
    return evidenceStorageDiagnostic(cause).reason;

  if (cause instanceof RegistryRequestError) return 'upstream';

  return 'unexpected';
};
