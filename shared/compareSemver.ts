type PrereleaseIdentifier = number | string;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly PrereleaseIdentifier[];
};

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Full version inputs can be queried directly; tags and v-prefixed inputs need registry resolution. */
export const isExactSemver = (value: string): boolean => !value.startsWith('v') && SEMVER_PATTERN.test(value);

const parseSemver = (value: string): ParsedSemver | null => {
  const match = value.trim().match(SEMVER_PATTERN);

  if (match === null) {
    return null;
  }

  const [, major, minor, patch, prerelease] = match;

  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease:
      prerelease === undefined
        ? []
        : prerelease.split('.').map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier)),
  };
};

const comparePrereleaseIdentifiers = (left: PrereleaseIdentifier, right: PrereleaseIdentifier): number => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'number') {
    return -1;
  }

  if (typeof right === 'number') {
    return 1;
  }

  return left < right ? -1 : left > right ? 1 : 0;
};

const comparePrerelease = (left: readonly PrereleaseIdentifier[], right: readonly PrereleaseIdentifier[]): number => {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }

  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return left.length - right.length;
    }

    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.length - right.length;
};

const compareParsedSemver = (left: ParsedSemver, right: ParsedSemver): number => {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
};

export const compareSemver = (left: string, right: string): number => {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);

  if (leftVersion === null || rightVersion === null) {
    return left.localeCompare(right, undefined, { numeric: true });
  }

  return compareParsedSemver(leftVersion, rightVersion);
};

export const sortSemverDescendingInPlace = (versions: string[]): void => {
  const parsedVersions = versions.map((version) => ({ version, parsed: parseSemver(version) }));

  parsedVersions.sort((left, right) => {
    if (left.parsed === null || right.parsed === null) {
      return right.version.localeCompare(left.version, undefined, { numeric: true });
    }

    return compareParsedSemver(right.parsed, left.parsed);
  });

  for (const [index, entry] of parsedVersions.entries()) {
    versions[index] = entry.version;
  }
};

export const createSemverAtLeastPredicate = (minimum: string): ((candidate: string) => boolean) => {
  const parsedMinimum = parseSemver(minimum);

  return (candidate: string): boolean => {
    const parsedCandidate = parseSemver(candidate);

    if (parsedCandidate === null || parsedMinimum === null) {
      return compareSemver(candidate, minimum) >= 0;
    }

    return compareParsedSemver(parsedCandidate, parsedMinimum) >= 0;
  };
};
