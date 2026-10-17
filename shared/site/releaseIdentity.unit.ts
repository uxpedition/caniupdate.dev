import { describe, expect, it } from 'vitest';

import { decodeReleaseTagReceipt, isStableReleaseVersion } from './releaseIdentity.ts';

const COMMIT_SHA = 'a'.repeat(40);

const receipt = {
  version: '1.2.3',
  tag: 'v1.2.3',
  commitSha: COMMIT_SHA,
  pipelineId: '4711',
};

describe('release identity', () => {
  it('accepts only stable MAJOR.MINOR.PATCH versions without leading zeroes', () => {
    expect(isStableReleaseVersion('0.0.0')).toBe(true);
    expect(isStableReleaseVersion('1.2.3')).toBe(true);
    expect(isStableReleaseVersion('01.2.3')).toBe(false);
    expect(isStableReleaseVersion('1.02.3')).toBe(false);
    expect(isStableReleaseVersion('1.2.03')).toBe(false);
    expect(isStableReleaseVersion('1.2.3-rc.1')).toBe(false);
    expect(isStableReleaseVersion('1.2.3+build.1')).toBe(false);
    expect(isStableReleaseVersion('1.2.3\n')).toBe(false);
  });

  it('decodes a receipt whose immutable tag matches its version', () => {
    expect(decodeReleaseTagReceipt(receipt)).toEqual(receipt);
  });

  it.each([
    { ...receipt, tag: 'v1.2.4' },
    { ...receipt, version: '1.2.3-rc.1', tag: 'v1.2.3-rc.1' },
    { ...receipt, commitSha: 'bad' },
    { ...receipt, commitSha: `${COMMIT_SHA}\n` },
    { ...receipt, pipelineId: '0' },
    { ...receipt, pipelineId: '04711' },
    { ...receipt, pipelineId: '4711\n' },
  ])('rejects malformed receipt %#', (invalidReceipt) => {
    expect(() => decodeReleaseTagReceipt(invalidReceipt)).toThrow(Error);
  });
});
