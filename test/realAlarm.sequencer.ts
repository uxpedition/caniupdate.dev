import { fileURLToPath } from 'node:url';

import { BaseSequencer, type TestSpecification } from 'vitest/node';

// These guards deliberately keep wall-clock alarms. Start them first so fast state-machine and pure-unit suites
// occupy the remaining workers while the guards wait. The rest retain Vitest's normal failure/duration ordering.
const realAlarmFiles = {
  [fileURLToPath(new URL('../workers/briefing/jobs.unit/leaseExpiry.unit.ts', import.meta.url))]: true,
  [fileURLToPath(new URL('../workers/briefing/sockets.unit/eviction.unit.ts', import.meta.url))]: true,
} as const;

export class RealAlarmFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);

    return sorted.sort(
      (a, b) => Number(realAlarmFiles[b.moduleId] === true) - Number(realAlarmFiles[a.moduleId] === true),
    );
  }
}
