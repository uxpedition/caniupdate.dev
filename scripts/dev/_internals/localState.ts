import { lstat, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const legacyStores = [
  ['d1', 'briefing'],
  ['do/can-i-update-local-evidence-PackageEvidence', 'evidence'],
  ['do/can-i-update-local-briefing-BriefingJob', 'briefing'],
] as const;

const directoryExists = async (path: string): Promise<boolean> => {
  try {
    if (!(await lstat(path)).isDirectory()) throw new Error(`Local storage is not a directory: ${path}`);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};

/** Called under the launcher lock, before any runtime opens SQLite. Directory renames keep WAL files with their DBs. */
export const migrateLocalState = async (persistTo: string): Promise<void> => {
  const moves: { source: string; destination: string }[] = [];

  for (const [store, owner] of legacyStores) {
    const source = join(persistTo, 'v3', store);

    if (!(await directoryExists(source))) continue;
    const destination = join(persistTo, owner, 'v3', store);

    if (await directoryExists(destination)) {
      throw new Error(
        `Local state exists in both ${source} and ${destination}. Stop and reconcile the stores before restarting; neither will be overwritten.`,
      );
    }

    moves.push({ source, destination });
  }

  // Preflight every destination before moving anything. A partially completed cutover resumes from remaining sources.
  for (const { source, destination } of moves) {
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }
};
