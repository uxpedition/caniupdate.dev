import type { SelectOption } from '~/components/form/select.defs';

const NUMERIC_TERM_PATTERN = /^[\d.]+$/;

const NUMERIC_SEGMENT_PATTERN = /^\d+$/;

const numericSkeleton = (text: string) =>
  text
    .split(/[.-]/)
    .filter((segment) => NUMERIC_SEGMENT_PATTERN.test(segment))
    .join('.');

const termRank = (text: string, term: string): number | null => {
  const target = NUMERIC_TERM_PATTERN.test(term) ? numericSkeleton(text) : text;

  if (target.startsWith(term)) {
    return 0;
  }

  let index = target.indexOf(term, 1);

  while (index !== -1) {
    const boundary = target[index - 1];

    if (boundary === '.' || boundary === '-') {
      return 1;
    }

    index = target.indexOf(term, index + 1);
  }

  return text.includes(term) ? 2 : null;
};

const optionTermRank = (option: SelectOption, term: string): number | null => {
  const labelRank = termRank(option.label.toLowerCase(), term);

  if (option.description === undefined) {
    return labelRank;
  }

  const descriptionRank = termRank(option.description.toLowerCase(), term);

  if (labelRank === null || descriptionRank === null) {
    return labelRank ?? descriptionRank;
  }

  return Math.min(labelRank, descriptionRank);
};

export const filterVersionOptions = (options: readonly SelectOption[], rawTerm: string): readonly SelectOption[] => {
  const term = rawTerm.trim().toLowerCase();

  if (term.length === 0) {
    return options;
  }

  const prefixMatches: SelectOption[] = [];
  const segmentMatches: SelectOption[] = [];
  const otherMatches: SelectOption[] = [];

  for (const option of options) {
    const rank = optionTermRank(option, term);

    if (rank === null) {
      continue;
    }

    if (rank === 0) {
      prefixMatches.push(option);
    } else if (rank === 1) {
      segmentMatches.push(option);
    } else {
      otherMatches.push(option);
    }
  }

  return [...prefixMatches, ...segmentMatches, ...otherMatches];
};
