import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;

import { noUnsafeDictionaryTypeRule } from './no-unsafe-dictionary-type';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });

describe('rules/no-unsafe-dictionary-type guard policy', () => {
  tester.run('guard subject and asserted result', noUnsafeDictionaryTypeRule, {
    valid: [
      'type Bag = { readonly id: string };\nfunction isBag(value: Record<string, unknown>): value is Bag { return false; }',
      'type Bag = { readonly id: string };\nfunction isBag(value: { [key: string]: unknown }): value is Bag { return false; }',
      'type Bag = { readonly id: string };\nfunction isBag(value: Bag, other: unknown): value is Bag { return false; }',
    ],
    invalid: [
      {
        code: 'type Metadata = Record<string, unknown>;\n',
        errors: [{ messageId: 'unsafeDictionary', data: { value: 'unknown' } }],
      },
      {
        code: 'function render(value: Record<string, unknown>): string { return ""; }',
        errors: [{ messageId: 'unsafeDictionary', data: { value: 'unknown' } }],
      },
      {
        code: 'function isBag(value: { readonly id: string }): value is Record<string, unknown> { return false; }',
        errors: [{ messageId: 'unsafeDictionary', data: { value: 'unknown' } }],
      },
    ],
  });
});
