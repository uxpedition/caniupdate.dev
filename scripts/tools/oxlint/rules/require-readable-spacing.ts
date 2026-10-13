import type { CreateRule } from '@oxlint/plugins';

import createPaddingLineRule from '../padding-line/padding-line-between-statements.ts';

const paddingRule = createPaddingLineRule([
  { blankLine: 'always', prev: 'import', next: '*' },
  { blankLine: 'always', prev: '*', next: { selector: 'Program > :not(ImportDeclaration)' } },
  { blankLine: 'always', prev: { selector: 'Program > :not(ImportDeclaration)' }, next: '*' },
  { blankLine: 'always', prev: '*', next: ['function', 'class', 'interface', 'type'] },
  { blankLine: 'always', prev: ['function', 'class', 'interface', 'type'], next: '*' },
  {
    blankLine: 'always',
    prev: '*',
    next: ['multiline-const', 'multiline-let', 'multiline-var', 'multiline-using'],
  },
  {
    blankLine: 'always',
    prev: ['multiline-const', 'multiline-let', 'multiline-var', 'multiline-using'],
    next: '*',
  },
  { blankLine: 'always', prev: '*', next: ['return', 'if', 'switch', 'try', 'for', 'while', 'do'] },
  { blankLine: 'always', prev: 'block-like', next: '*' },
  { blankLine: 'any', prev: 'import', next: 'import' },
  {
    blankLine: 'any',
    prev: {
      selector: ':matches(TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"])',
    },
    next: {
      selector:
        ':matches(TSDeclareFunction, FunctionDeclaration, ExportNamedDeclaration[declaration.type="TSDeclareFunction"], ExportNamedDeclaration[declaration.type="FunctionDeclaration"])',
    },
  },
]);

/** Restore structural blank lines with whitespace-only fixes; keep local short bindings and overloads grouped. */
export const requireReadableSpacingRule: CreateRule = {
  ...paddingRule,
  meta: {
    ...paddingRule.meta,
    docs: {
      description: 'Require readable spacing between declarations and logical statement groups.',
    },
    messages: {
      unexpectedBlankLine:
        'unexpected blank line before this statement' +
        '\nhelp: remove the blank line between the statements without removing comments',
      expectedBlankLine:
        'missing blank line before this statement' +
        '\nhelp: separate these statement groups with a blank line, or apply the whitespace autofix' +
        '\nnote: consecutive imports and overload signatures may remain grouped; preserve comments with their owning statement',
    },
    schema: [],
  },
};
