import { Array, Match, Order, Result } from 'effect';

import type {
  InstallInspection,
  InstallImplementationComparison,
} from '../../../shared/comparison/evidence/installScripts.defs';

/** Compare only content observed on both sides; an untraced file is not an absent file. */
export function compareInstallImplementation(
  from: InstallInspection,
  to: InstallInspection,
): InstallImplementationComparison {
  const previous = new Map(Array.map(from.files, (file) => [file.path, file.sha256]));

  const changedFiles = Array.filterMap(to.files, (file) => {
    const before = previous.get(file.path);

    return before !== undefined && before !== file.sha256 ? Result.succeed(file.path) : Result.failVoid;
  });

  const statuses = [from.analysis.status, to.analysis.status];

  return {
    status: Match.value(statuses).pipe(
      Match.when(
        (values) => Array.contains(values, 'unavailable'),
        (): InstallImplementationComparison['status'] => 'unavailable',
      ),
      Match.when(
        (values) => Array.contains(values, 'partial'),
        (): InstallImplementationComparison['status'] => 'partial',
      ),
      Match.orElse((): InstallImplementationComparison['status'] => 'available'),
    ),
    changedFiles: Array.sort(changedFiles, Order.String),
  };
}
