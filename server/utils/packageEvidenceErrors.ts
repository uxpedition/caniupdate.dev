import { Data } from 'effect';

export const RegistryRequestError = Data.TaggedError('RegistryRequestError')<{
  readonly cause: unknown;
}>;

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
