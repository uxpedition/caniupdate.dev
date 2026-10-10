import { describe, expect, it } from 'vitest';

import type { SelectOption } from '~/components/form/select.defs';

import { filterVersionOptions } from './versionSearch';

const versions = (labels: readonly string[]): SelectOption[] => labels.map((label) => ({ value: label, label }));

const labels = (options: readonly SelectOption[]) => options.map((option) => option.label);

// Deliberately interleaved tiers: filtering must preserve input order within each tier.
const numericOptions = versions([
  '19.3.0-canary-fb2177c1-20251114',
  '19.3.0-canary-172742b4-20260716',
  '19.0.0-rc.17',
  '18.0.0-alpha-bc9bb87c2-20210917',
  '18.0.0',
  '17.0.2',
  '17.0.1',
  '17.0.0',
  '17.0.0-rc.3',
  '17.0.0-rc.2',
  '17.0.0-rc.1',
  '17.0.0-rc.0',
  '16.17.0',
  '0.0.0-experimental-fb2177c1-20251114',
]);

const tagOptions: SelectOption[] = [
  { value: 'tag:next', label: 'next', description: '19.3.0-canary-2b19aecd-20260916' },
  { value: 'tag:latest', label: 'latest', description: '19.3.0' },
  { value: 'tag:canary', label: 'canary', description: '19.3.0-canary-2b19aecd-20260916' },
  { value: 'tag:experimental', label: 'experimental', description: '0.0.0-experimental-ec9cc003-20251208' },
  ...versions(['19.3.0-canary-2b19aecd-20260916', '19.3.0', '19.2.0-rc.1', '0.0.0-experimental-ec9cc003-20251208']),
];

describe('filterVersionOptions', () => {
  it('returns the original options unchanged for empty or whitespace-only searches', () => {
    const options = Object.freeze([
      Object.freeze({ value: 'tag:latest', label: 'latest', description: '19.3.0' }),
      Object.freeze({ value: '19.3.0', label: '19.3.0', separatorBefore: true, disabled: true }),
    ]);

    expect(filterVersionOptions(options, '')).toBe(options);
    expect(filterVersionOptions(options, ' \t\n ')).toBe(options);
  });

  it('ranks numeric prefixes before numeric segments, then hash/date substrings, stably', () => {
    expect(labels(filterVersionOptions(numericOptions, '17'))).toEqual([
      '17.0.2',
      '17.0.1',
      '17.0.0',
      '17.0.0-rc.3',
      '17.0.0-rc.2',
      '17.0.0-rc.1',
      '17.0.0-rc.0',
      '19.0.0-rc.17',
      '16.17.0',
      '19.3.0-canary-fb2177c1-20251114',
      '19.3.0-canary-172742b4-20260716',
      '18.0.0-alpha-bc9bb87c2-20210917',
      '0.0.0-experimental-fb2177c1-20251114',
    ]);
  });

  it('matches dotted numeric terms within the core and through tag descriptions', () => {
    expect(labels(filterVersionOptions(tagOptions, '3.0'))).toEqual([
      'next',
      'latest',
      'canary',
      '19.3.0-canary-2b19aecd-20260916',
      '19.3.0',
    ]);
  });

  it('joins numeric segments across prerelease text for numeric terms', () => {
    const options = versions(['1.2-rc.3', '1.2.3', '1.20-rc.3']);

    expect(labels(filterVersionOptions(options, '2.3'))).toEqual(['1.2-rc.3', '1.2.3']);
  });

  it('treats dates as numeric segments and retains their input order', () => {
    const options = versions([
      '19.3.0-canary-ec9cc003-20251208',
      '19.3.0-canary-55480b4d-20251208',
      '19.3.0-canary-2b19aecd-20260916',
      '0.0.0-experimental-ec9cc003-20251208',
      '0.0.0-experimental-55480b4d-20251208',
    ]);

    const expected = [
      '19.3.0-canary-ec9cc003-20251208',
      '19.3.0-canary-55480b4d-20251208',
      '0.0.0-experimental-ec9cc003-20251208',
      '0.0.0-experimental-55480b4d-20251208',
    ];

    expect(labels(filterVersionOptions(options, '2025'))).toEqual(expected);
    expect(labels(filterVersionOptions(options, '20251208'))).toEqual(expected);
  });

  it('ranks an alphabetic tag prefix above earlier tags matching through descriptions', () => {
    expect(labels(filterVersionOptions(tagOptions, 'canary'))).toEqual([
      'canary',
      'next',
      '19.3.0-canary-2b19aecd-20260916',
    ]);
  });

  it('matches mixed alphabetic and numeric terms in the original text', () => {
    expect(labels(filterVersionOptions(tagOptions, 'canary-2b19'))).toEqual([
      'next',
      'canary',
      '19.3.0-canary-2b19aecd-20260916',
    ]);
    expect(labels(filterVersionOptions(tagOptions, 'rc'))).toEqual(['19.2.0-rc.1']);
    expect(labels(filterVersionOptions(tagOptions, 'experimental'))).toEqual([
      'experimental',
      '0.0.0-experimental-ec9cc003-20251208',
    ]);
    expect(labels(filterVersionOptions(tagOptions, '0.0.0-experimental'))).toEqual([
      'experimental',
      '0.0.0-experimental-ec9cc003-20251208',
    ]);
  });

  it('uses the best rank from either field, including a description prefix', () => {
    const options: SelectOption[] = [
      { value: 'segment', label: '19.17.0' },
      { value: 'description-only', label: 'release', description: '17.0.2' },
      { value: 'description-better', label: 'build17', description: '17.0.0-rc.1' },
      { value: 'label-only', label: '17-local', description: 'unrelated' },
      { value: 'neither', label: 'latest', description: '19.3.0' },
    ];

    // `release` matches only through its description; `build17` is rank 2 by label but rank 0 by description.
    expect(labels(filterVersionOptions(options, '17'))).toEqual(['release', 'build17', '17-local', '19.17.0']);
  });

  it('continues searching after a non-boundary occurrence to find a later segment match', () => {
    const options = versions(['xcanary', 'xcanary-canary', 'canary', 'xcanary.canary']);

    expect(labels(filterVersionOptions(options, 'canary'))).toEqual([
      'canary',
      'xcanary-canary',
      'xcanary.canary',
      'xcanary',
    ]);
  });

  it('normalizes surrounding whitespace and case in the term and both option fields', () => {
    const options: SelectOption[] = [
      { value: 'next', label: 'Next', description: '19.3.0-CANARY-abcd' },
      { value: 'canary', label: 'CaNaRy' },
      { value: 'stable', label: 'latest', description: '19.3.0' },
    ];

    expect(labels(filterVersionOptions(options, ' \tCaNaRy\n'))).toEqual(['CaNaRy', 'Next']);
  });

  it('returns no options for unmatched terms or an empty input list', () => {
    expect(filterVersionOptions(tagOptions, 'missing')).toEqual([]);
    expect(filterVersionOptions([], '17')).toEqual([]);
  });

  it('does not mutate options or strip separator and disabled metadata while filtering', () => {
    const segment = Object.freeze({ value: '18.17.0', label: '18.17.0', separatorBefore: true });
    const prefix = Object.freeze({ value: '17.0.2', label: '17.0.2', disabled: true });
    const options = Object.freeze([segment, prefix]);
    const result = filterVersionOptions(options, '17');

    expect(result).toEqual([prefix, segment]);
    expect(result[0]).toBe(prefix);
    expect(result[1]).toBe(segment);
    expect(options).toEqual([segment, prefix]);
  });
});
