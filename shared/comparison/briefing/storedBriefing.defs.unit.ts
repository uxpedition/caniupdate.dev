import { describe, expect, it } from 'vitest';

import { decodeStoredBriefingResult } from './storedBriefing.defs';

const briefing = {
  status: 'available',
  model: 'test-model',
  bullets: [{ kind: 'coverage', basis: 'fact', text: 'Coverage is limited.', evidenceNumbers: [0] }],
  sources: [{ number: 0, id: 'coverage', kind: 'coverage', label: 'Coverage', urls: [], text: '{}' }],
} as const;

const identity = { packageName: '@scope/package', from: '1.0.0', to: '2.0.0' };

describe('decodeStoredBriefingResult', () => {
  it('decodes a miss separately from a stored successful briefing', () => {
    expect(decodeStoredBriefingResult({ status: 'missing', ...identity })).toEqual({
      status: 'missing',
      ...identity,
    });
    expect(decodeStoredBriefingResult({ status: 'available', ...identity, briefing })).toEqual({
      status: 'available',
      ...identity,
      briefing,
    });
  });

  it('rejects invalid identities, unavailable briefings, and undeclared fields', () => {
    expect(() => decodeStoredBriefingResult({ status: 'missing', ...identity, privateField: 'secret' })).toThrow();
    expect(() =>
      decodeStoredBriefingResult({ status: 'available', ...identity, briefing: { status: 'unavailable' } }),
    ).toThrow();
    expect(() => decodeStoredBriefingResult({ status: 'missing', ...identity, packageName: ' ' })).toThrow();
  });
});
