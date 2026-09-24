import type { ArchiveAdmission } from '../../server/utils/packageComparisonFacts';

export const MAX_ACTIVE_ARCHIVE_INSPECTIONS = 2;
export const MAX_ACTIVE_EVIDENCE_RESPONSES = 2;

export class ArchiveCapacityError extends Error {
  readonly name = 'ArchiveCapacityError';
}

export class ResponseCapacityError extends Error {
  readonly name = 'ResponseCapacityError';
}

/** Counts active archive inspections in this Worker isolate without sharing any object I/O promise. */
export class BoundedArchiveAdmission implements ArchiveAdmission {
  private active = 0;

  constructor(private readonly limit = MAX_ACTIVE_ARCHIVE_INSPECTIONS) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Archive admission limit must be positive');
  }

  acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      return Promise.reject(new ArchiveCapacityError('Archive inspection capacity is temporarily exhausted'));
    }
    this.active += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      this.active -= 1;
    });
  }

  get activeCount(): number {
    return this.active;
  }
}

export class BoundedResponseAdmission {
  private active = 0;

  constructor(private readonly limit = MAX_ACTIVE_EVIDENCE_RESPONSES) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Response admission limit must be positive');
  }

  acquire(): () => void {
    if (this.active >= this.limit) {
      throw new ResponseCapacityError('Evidence response capacity is temporarily exhausted');
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }

  get activeCount(): number {
    return this.active;
  }
}
