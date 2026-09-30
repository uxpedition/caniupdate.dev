import type { ArchiveAdmission } from '../../server/utils/packageComparisonFacts';
import { ArchiveCapacityError, ResponseCapacityError } from '../../server/utils/packageEvidenceErrors';

export { ArchiveCapacityError, ResponseCapacityError };

export const MAX_ACTIVE_ARCHIVE_INSPECTIONS = 2;
export const MAX_ACTIVE_EVIDENCE_RESPONSES = 2;

/** Counts active archive inspections in this Worker isolate without sharing any object I/O promise. */
export class BoundedArchiveAdmission implements ArchiveAdmission {
  private active = 0;

  constructor(private readonly limit = MAX_ACTIVE_ARCHIVE_INSPECTIONS) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Archive admission limit must be positive');
  }

  acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      return Promise.reject(new ArchiveCapacityError({ capacity: this.limit }));
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
      throw new ResponseCapacityError({ capacity: this.limit });
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
