import { describe, expect, it } from 'vitest';

import { isStableReleaseVersion } from '../../shared/site/releaseIdentity.ts';
import { assertReleaseVersionAdvances, compareStableReleaseVersions, ReleaseAutomationFailure } from './version.ts';

describe('stable release versions', () => {
  it.each(['0.1.0', '1.0.0', '2147483648.0.0'])('accepts stable SemVer %s', (version) => {
    expect(isStableReleaseVersion(version)).toBe(true);
  });

  it.each(['', '1', '1.2', '01.2.3', '1.02.3', '1.2.03', '1.2.3-rc.1', '1.2.3+build'])(
    'rejects non-release version %s',
    (version) => {
      expect(isStableReleaseVersion(version)).toBe(false);
    },
  );

  it('compares arbitrarily large numeric components without Number precision loss', () => {
    expect(compareStableReleaseVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBe(1);
    expect(compareStableReleaseVersions('1.10.0', '1.9.99')).toBe(1);
  });

  it('requires the selected release to advance beyond the latest stable tag', () => {
    expect(() => assertReleaseVersionAdvances('1.2.3', '1.2.3')).toThrow(ReleaseAutomationFailure);
    expect(() => assertReleaseVersionAdvances('1.2.2', '1.2.3')).toThrow(ReleaseAutomationFailure);
    expect(() => assertReleaseVersionAdvances('1.2.3-rc.1', '1.2.2')).toThrow(ReleaseAutomationFailure);
    expect(assertReleaseVersionAdvances('1.2.4', '1.2.3')).toBeUndefined();
    expect(assertReleaseVersionAdvances('0.1.0', undefined)).toBeUndefined();
  });
});
