import { Array, Option, String } from 'effect';

import type { PackageDeclarationsResponse, PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import type { InstallFinding } from '#shared/comparison/evidence/installScripts.defs';

export const installActionLabels: Record<InstallFinding['kind'], string> = {
  network: 'Network requests',
  process: 'Runs other programs',
  'file-read': 'Reads files',
  'file-open': 'Opens files',
  'file-write': 'Writes or changes files',
  'file-delete': 'Deletes files',
  environment: 'Reads environment settings',
  'dynamic-code': 'Creates code at runtime',
  'native-build': 'Builds native code',
};

export function matchingInstallMeasurements(
  declarations: PackageDeclarationsResponse,
  measurements: PackageMeasurementsResponse | undefined,
): PackageMeasurementsResponse | undefined {
  return Option.fromNullishOr(measurements).pipe(
    Option.filter(
      (value) =>
        value.packageName === declarations.packageName &&
        value.from.name === declarations.from.name &&
        value.to.name === declarations.to.name &&
        value.from.version === declarations.from.version &&
        value.to.version === declarations.to.version,
    ),
    Option.getOrUndefined,
  );
}

export function installSourceLink(packageName: string, version: string, path: string, line: number): string {
  const name = Array.join(Array.map(String.split(packageName, '/'), encodeURIComponent), '/');
  const file = Array.join(Array.map(String.split(path, '/'), encodeURIComponent), '/');

  return `https://npmx.dev/package-code/${name}/v/${encodeURIComponent(version)}/${file}#L${line}`;
}
