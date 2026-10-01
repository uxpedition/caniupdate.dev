import { Effect, Option, Semaphore } from 'effect';

import type { ArchiveAdmission } from '../../server/utils/packageComparisonFacts';
import { ArchiveCapacityError, ResponseCapacityError } from '../../server/utils/packageEvidenceErrors';

export { ArchiveCapacityError, ResponseCapacityError };

export const MAX_ACTIVE_ARCHIVE_INSPECTIONS = 2;
export const MAX_ACTIVE_EVIDENCE_RESPONSES = 2;

type ArchiveCapacityFailure = InstanceType<typeof ArchiveCapacityError>;
type ResponseCapacityFailure = InstanceType<typeof ResponseCapacityError>;

/** Runs work through one isolate-scoped, reject-fast semaphore. */
class BoundedAdmission<Failure> {
  readonly #semaphore: Semaphore.Semaphore;

  constructor(
    private readonly limit: number,
    private readonly capacityError: () => Failure,
    label: string,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`${label} admission limit must be positive`);
    this.#semaphore = Semaphore.makeUnsafe(limit);
  }

  withPermit<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Failure, R> {
    return this.#semaphore
      .withPermitsIfAvailable(1)(effect)
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(this.capacityError()),
            onSome: Effect.succeed,
          }),
        ),
      );
  }
}

/** Bounds archive inspections without waiting or sharing another object's I/O promise. */
export class BoundedArchiveAdmission extends BoundedAdmission<ArchiveCapacityFailure> implements ArchiveAdmission {
  constructor(limit = MAX_ACTIVE_ARCHIVE_INSPECTIONS) {
    super(limit, () => new ArchiveCapacityError({ capacity: limit }), 'Archive');
  }
}

/** Bounds evidence collections and incoming requests without queueing. */
export class BoundedResponseAdmission extends BoundedAdmission<ResponseCapacityFailure> {
  constructor(limit = MAX_ACTIVE_EVIDENCE_RESPONSES) {
    super(limit, () => new ResponseCapacityError({ capacity: limit }), 'Response');
  }
}
