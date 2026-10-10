import { Effect, Fiber } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { BoundedArchiveAdmission, BoundedResponseAdmission } from './admission';

type Admission = {
  withPermit<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, unknown, R>;
};

const admissionCases: ReadonlyArray<{
  readonly name: string;
  readonly capacityErrorTag: string;
  readonly create: () => Admission;
}> = [
  {
    name: 'archive',
    capacityErrorTag: 'ArchiveCapacityError',
    create: () => new BoundedArchiveAdmission(1),
  },
  {
    name: 'response',
    capacityErrorTag: 'ResponseCapacityError',
    create: () => new BoundedResponseAdmission(1),
  },
];

describe.each(admissionCases)('bounded $name admission', ({ capacityErrorTag, create }) => {
  it('does not execute work when capacity is already exhausted', async () => {
    const admission = create();
    const gate = Promise.withResolvers<void>();
    let ownerStarted = false;

    const owner = Effect.runPromise(
      admission.withPermit(
        Effect.gen(function* () {
          ownerStarted = true;
          yield* Effect.promise(() => gate.promise);
        }),
      ),
    );

    try {
      await vi.waitFor(() => expect(ownerStarted).toBe(true));
      let rejectedWorkStarted = false;
      await expect(
        Effect.runPromise(admission.withPermit(Effect.sync(() => (rejectedWorkStarted = true)))),
      ).rejects.toMatchObject({ _tag: capacityErrorTag, capacity: 1 });
      expect(rejectedWorkStarted).toBe(false);
    } finally {
      gate.resolve();
      await owner;
    }
  });

  it.each([
    ['success', () => Effect.void],
    ['failure', () => Effect.fail(new Error('expected failure'))],
    ['defect', () => Effect.die('expected defect')],
  ])('returns a permit after a %s exit', async (_exit, createTerminalEffect) => {
    const admission = create();

    await Effect.runPromiseExit(admission.withPermit(createTerminalEffect()));

    await expect(Effect.runPromise(admission.withPermit(Effect.succeed('available')))).resolves.toBe('available');
  });

  it('returns a permit when guarded work is interrupted', async () => {
    const admission = create();
    let ownerStarted = false;

    const owner = Effect.runFork(
      admission.withPermit(
        Effect.gen(function* () {
          ownerStarted = true;
          yield* Effect.never;
        }),
      ),
    );

    await vi.waitFor(() => expect(ownerStarted).toBe(true));
    await Effect.runPromise(Fiber.interrupt(owner));

    await expect(Effect.runPromise(admission.withPermit(Effect.succeed('available')))).resolves.toBe('available');
  });
});
