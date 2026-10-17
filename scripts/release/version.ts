import { isStableReleaseVersion } from '../../shared/site/releaseIdentity.ts';

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export class ReleaseAutomationFailure extends Error {}

function compareVersionPart(left: string | undefined, right: string | undefined): -1 | 0 | 1 {
  if (left === undefined || right === undefined) {
    throw new ReleaseAutomationFailure('Release version could not be compared');
  }

  const leftPart = BigInt(left);
  const rightPart = BigInt(right);

  if (leftPart < rightPart) return -1;
  if (leftPart > rightPart) return 1;

  return 0;
}

export function compareStableReleaseVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = VERSION_PATTERN.exec(left);
  const rightParts = VERSION_PATTERN.exec(right);

  if (leftParts === null || rightParts === null) {
    throw new ReleaseAutomationFailure('Release versions must use stable MAJOR.MINOR.PATCH SemVer');
  }

  const major = compareVersionPart(leftParts[1], rightParts[1]);

  if (major !== 0) return major;

  const minor = compareVersionPart(leftParts[2], rightParts[2]);

  if (minor !== 0) return minor;

  return compareVersionPart(leftParts[3], rightParts[3]);
}

export function assertReleaseVersionAdvances(version: string, currentVersion: string | undefined): void {
  if (!isStableReleaseVersion(version)) {
    throw new ReleaseAutomationFailure('Enter a stable MAJOR.MINOR.PATCH SemVer version');
  }

  if (currentVersion !== undefined && compareStableReleaseVersions(version, currentVersion) <= 0) {
    throw new ReleaseAutomationFailure('Release version must be newer than the latest release tag');
  }
}
