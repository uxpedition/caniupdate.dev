import { Effect, Option, Semaphore } from 'effect';

import { ArchiveCapacityError, ResponseCapacityError } from '../../server/comparison/evidence/errors';
import type { ArchiveAdmission } from '../../server/comparison/evidence/services';

export { ArchiveCapacityError, ResponseCapacityError };

export const MAX_ACTIVE_ARCHIVE_INSPECTIONS = 2;

export const MAX_ACTIVE_EVIDENCE_RESPONSES = 2;

type ArchiveCapacityFailure = InstanceType<typeof ArchiveCapacityError>;

type ResponseCapacityFailure = InstanceType<typeof ResponseCapacityError>;

type AdmissionOperation = 'archive' | 'collection' | 'request';

/** Runs work through one isolate-scoped, reject-fast semaphore. */
class BoundedAdmission<Failure> {
  readonly #semaphore: Semaphore.Semaphore;

  constructor(
    private readonly limit: number,
    private readonly capacityError: () => Failure,
    label: string,
    private readonly operation: AdmissionOperation,
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
            // Refusal is decided here, so this is the single emission point for `evidence.admission.refused`.
            onNone: () =>
              Effect.logInfo('evidence.admission.refused').pipe(
                Effect.annotateLogs({ operation: this.operation, outcome: 'failure', reason: 'capacity' }),
                Effect.andThen(Effect.fail(this.capacityError())),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
  }
}

/** Bounds archive inspections without waiting or sharing another object's I/O promise. */
export class BoundedArchiveAdmission extends BoundedAdmission<ArchiveCapacityFailure> implements ArchiveAdmission {
  constructor(limit = MAX_ACTIVE_ARCHIVE_INSPECTIONS) {
    super(limit, () => new ArchiveCapacityError({ capacity: limit }), 'Archive', 'archive');
  }
}

/** Bounds evidence collections or incoming requests without queueing; `operation` names what was refused. */
export class BoundedResponseAdmission extends BoundedAdmission<ResponseCapacityFailure> {
  constructor(limit = MAX_ACTIVE_EVIDENCE_RESPONSES, operation: 'collection' | 'request' = 'collection') {
    super(limit, () => new ResponseCapacityError({ capacity: limit }), 'Response', operation);
  }
}
